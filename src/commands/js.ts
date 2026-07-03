import vm from 'node:vm'
import type { Context } from '../context'
import { installPrototypeGuards, installRestGuard } from '../prototype-guard'
import { guardOutbound } from '../security'
import { inspectResult, MESSAGE_LIMIT, stripAnsi } from '../util/format'
import { loadLibraryModule } from '../util/meta'
import type { Command } from './registry'

const ENABLE = new Set(['on', 'true', 't', 'yes', 'y', '1', 'enable'])
const DISABLE = new Set(['off', 'false', 'f', 'no', 'n', '0', 'disable'])

const GUARDED_CHILD_PROCESS_METHODS = new Set(['execSync', 'execFileSync', 'spawnSync'])

/**
 * Wraps `fn` (one of `child_process`'s `execSync`/`execFileSync`/`spawnSync`) so a call that
 * doesn't specify its own `timeout` gets `timeoutMs` as a default, without overriding a value
 * the eval's own code explicitly passed.
 *
 * These three are the common way eval'd code blocks on a *native* call rather than JS
 * execution — and unlike a synchronous JS loop, {@link EvalTimedOutError}'s `vm.Script` timeout
 * can't preempt them (V8's execution watchdog only checks in during actual bytecode execution,
 * not while parked waiting on a native/libuv call to return; confirmed experimentally). They
 * do, however, each already support their own native `timeout` option (which kills the child
 * and unblocks the parent) — this just makes sure one is always set.
 *
 * Doesn't help with other blocking natives with no such option (`fs.readFileSync` hung on a
 * slow pipe, a bare `Atomics.wait()`, ...) — those remain a real, if rarer, gap.
 */
// biome-ignore lint/suspicious/noExplicitAny: forwarding execSync/execFileSync/spawnSync's overloaded signatures verbatim.
function withDefaultTimeout(fn: (...args: any[]) => any, timeoutMs: number) {
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  return (...args: any[]) => {
    const last = args[args.length - 1]
    if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
      if (last.timeout === undefined) args[args.length - 1] = { ...last, timeout: timeoutMs }
    } else {
      args.push({ timeout: timeoutMs })
    }
    return fn(...args)
  }
}

/**
 * Compiles user code into a `vm.Script` whose top-level statement immediately invokes an
 * async function taking `argNames` as parameters, applied to whatever's stashed at
 * `globalThis[argsKey]` at call time (see the handler below).
 *
 * Run via `runInThisContext()` — the *current* realm, not a new sandboxed one — so it behaves
 * exactly like the plain `AsyncFunction` this replaces: full access to Node's ambient globals,
 * and live object references (client, message, ...) passed as args work unchanged, with no
 * serialization boundary. The difference is that `Script#runInThisContext` accepts a
 * `timeout`, which `AsyncFunction` calls never could — see {@link EvalTimedOutError}.
 *
 * First tries to treat the whole input as a single expression (auto-returning its
 * value, e.g. `1 + 1`); if that isn't valid syntax, falls back to a statement body
 * where the user is expected to `return` explicitly.
 */
function compile(code: string, argNames: string[], argsKey: string): vm.Script {
  const params = argNames.join(', ')
  const invocation = `.apply(null, globalThis[${JSON.stringify(argsKey)}])`
  try {
    return new vm.Script(`(async function (${params}) {\nreturn (${code}\n);\n})${invocation}`, {
      filename: 'jsk js',
    })
  } catch {
    return new vm.Script(`(async function (${params}) {\n${code}\n})${invocation}`, {
      filename: 'jsk js',
    })
  }
}

// biome-ignore lint/suspicious/noExplicitAny: structural Message check across libraries.
function isMessage(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'author' in value &&
    typeof value.react === 'function' &&
    ('url' in value || 'id' in value)
  )
}

/** Thrown to unwind a `jsk js` eval that was stopped via `jsk cancel`. */
class EvalCancelledError extends Error {
  constructor() {
    super('Cancelled via jsk cancel.')
    this.name = 'EvalCancelledError'
  }
}

/**
 * Thrown when a synchronous stretch of a `jsk js` eval (e.g. a bare `while (true) {}`) ran
 * longer than `evalTimeout` and was forcibly terminated by V8's execution watchdog — confirmed
 * experimentally to genuinely preempt a tight JS loop, unlike JS-level cooperative cancellation
 * (V8 checks for a pending termination request at loop back-edges/calls during actual bytecode
 * execution, so this doesn't require the running code to yield).
 *
 * Unlike {@link EvalCancelledError}, this can't be triggered by `jsk cancel` reactively —
 * while the eval is stuck in synchronous code, the whole bot process is blocked (nothing else
 * runs either, including processing a cancel request), so there's no "react to the command"
 * moment available. `evalTimeout` is a hard cap enforced up front instead.
 *
 * Known gap: this covers synchronous *JS* execution, not a blocking *native* call the code
 * might make (e.g. `child_process.execSync` on a slow command) — confirmed experimentally that
 * such a call is NOT interrupted by the timeout, since V8's watchdog only preempts during
 * bytecode execution, not while parked waiting on a native/libuv call to return. Short of
 * restarting the process, there's currently no way around that; it would need running the eval
 * in a separate thread that can be forcibly terminated (`node:worker_threads`), which isn't
 * viable here without losing direct, synchronous access to the live client/message/channel
 * objects `jsk js` is built around (they aren't structured-cloneable across a worker boundary).
 */
class EvalTimedOutError extends Error {
  constructor(timeoutMs: number) {
    super(`Synchronous execution exceeded ${timeoutMs}ms and was terminated.`)
    this.name = 'EvalTimedOutError'
  }
}

/**
 * Resolves/rejects with `promise`, but rejects with {@link EvalCancelledError} as soon as
 * `signal` aborts — whichever comes first.
 *
 * This only wins the race at an `await` point in the running eval (or in a Promise chain it
 * started, e.g. a pending `fetch`) — it doesn't help with a synchronous runaway (`while (true)
 * {}` blocks the event loop entirely, so nothing — this included — runs until it returns
 * control); {@link EvalTimedOutError} covers that case instead. This one covers the far more
 * common "hang" shape: an eval stuck awaiting something that never resolves (an infinite retry
 * loop with an `await` in it, a Discord call that never comes back, `await new Promise(() =>
 * {})`, ...).
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new EvalCancelledError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new EvalCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

type WriteFn = typeof process.stdout.write

/**
 * Temporarily wraps `process.stdout`/`process.stderr`'s `write()`, so `jsk js` can surface
 * everything written to the terminal during the eval — not just `console.*` (which itself
 * writes through these same streams under the hood), but also raw `process.stdout.write()`
 * calls and output from any library the user code touches. `restore()` undoes the wrapping and
 * returns the captured text; safe to call more than once.
 *
 * `scrub`, when given (security mode), is also applied to what actually reaches the real
 * stream — not just the copy captured here for Discord — so a `console.log(client.token)`
 * doesn't leak the token into the bot's own local output/logs either. `null` (the default
 * outside security mode) leaves real output completely untouched, unchanged from before.
 *
 * This patches the process-wide streams for the eval's duration, so two `jsk js` evals
 * running concurrently would see each other's output in their capture — an accepted
 * trade-off for a single-owner debug tool.
 */
function captureTerminalOutput(scrub: ((text: string) => string) | null): {
  restore: () => string
} {
  const chunks: string[] = []
  const originalStdoutWrite: WriteFn = process.stdout.write
  const originalStderrWrite: WriteFn = process.stderr.write

  // Calls the original via `.apply(stream, ...)` rather than a pre-bound reference, so
  // `restore()` can put back the exact original function (not a `.bind()` wrapper around
  // it) — otherwise repeated eval calls would pile up an ever-growing chain of bound wrappers.
  const wrap =
    (stream: NodeJS.WriteStream, original: WriteFn): WriteFn =>
    (chunk: unknown, ...rest: unknown[]) => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf-8')
            : String(chunk)
      // Stripped for the Discord-bound capture only — colors are decided by whether the
      // *real* stdout/stderr is a TTY, which has nothing to do with whether this is headed to
      // Discord (not a terminal), so raw escape codes would otherwise show up as literal
      // garbage (see stripAnsi's doc comment). The real stream output is left untouched.
      chunks.push(stripAnsi(text))
      const outgoing = scrub ? scrub(text) : chunk
      // biome-ignore lint/suspicious/noExplicitAny: forwarding Node's overloaded write(chunk, encoding?, callback?) verbatim.
      return (original as any).apply(stream, [outgoing, ...rest])
    }

  process.stdout.write = wrap(process.stdout, originalStdoutWrite)
  process.stderr.write = wrap(process.stderr, originalStderrWrite)

  return {
    restore: () => {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
      return chunks.join('')
    },
  }
}

/**
 * Sends `terminalOutput` (wrapped in a codeblock) followed by `text` (plain), preferring a
 * single combined message when it fits.
 *
 * When it doesn't fit, the two are sent as separate, independently-paginated messages instead
 * of combining them into one oversized string and handing that to {@link Context.sendResult}:
 * that pagination is codeblock-*unaware* (by design — it's also used for plain results with no
 * codeblock at all), so it slices the combined text at fixed byte offsets with no regard for
 * where the codeblock's fences landed. The fences only happen to survive at the very start of
 * page 1 and the very end of the last page; every page in between is missing both, since
 * nothing re-opens/re-closes the codeblock at the split points. Sending `terminalOutput`
 * through {@link Context.sendCodeblock} instead re-wraps every page in its own fences.
 */
async function sendTerminalAndText(
  ctx: Context,
  terminalOutput: string,
  text: string | null,
  filename: string,
): Promise<void> {
  if (!terminalOutput) {
    if (text !== null) await ctx.sendResult(text, filename)
    return
  }

  const codeblock = `\`\`\`\n${terminalOutput}\n\`\`\``
  const combined = text !== null ? `${codeblock}\n${text}` : codeblock

  // Matches Context.sendResult's own scrubbed-length check, so this decides on the same basis
  // it will (scrubbing doesn't reliably preserve length, and ctx.sendResult scrubs again below
  // regardless — redaction is idempotent, so double-scrubbing is harmless).
  if (ctx.jsk.scrub(combined).length <= MESSAGE_LIMIT) {
    await ctx.sendResult(combined, filename)
    return
  }

  await ctx.sendCodeblock(terminalOutput, '', filename)
  if (text !== null) await ctx.sendResult(text, filename)
}

async function sendResult(ctx: Context, result: unknown, terminalOutput: string): Promise<void> {
  const resultText = isMessage(result)
    ? // biome-ignore lint/suspicious/noExplicitAny: verified Message-like above.
      `<Message ${(result as any).url ?? (result as any).id}>`
    : result === undefined
      ? null
      : inspectResult(result)

  if (!terminalOutput && resultText === null) return

  // Routed through sendTerminalAndText (which itself routes through ctx.sendResult/
  // sendCodeblock, not a raw send) so the captured terminal output gets the same token
  // redaction / security-mode secret scrubbing as everything else djsk sends.
  await sendTerminalAndText(ctx, terminalOutput, resultText, 'output.js')
}

const jsCommand: Command = {
  name: 'js',
  aliases: ['javascript', 'eval'],
  summary: 'Evaluates JavaScript. Single expressions auto-return; use `return` for statements.',
  async handler(ctx) {
    const code = ctx.codeblock.content
    if (!code.trim()) {
      await ctx.send('No code to evaluate.')
      return
    }

    const jsk = ctx.jsk

    // In security mode, hand the scope guarded objects so user code that sends/replies/edits
    // (message, channel, DMs, interactions reachable through them) is scrubbed too.
    const guard = (value: unknown): unknown =>
      jsk.config.security && value && typeof value === 'object'
        ? guardOutbound(value, (text) => jsk.scrub(text))
        : value

    const controller = new AbortController()

    const scope: Record<string, unknown> = {
      client: ctx.client,
      bot: ctx.client,
      ctx,
      message: guard(ctx.message),
      msg: guard(ctx.message),
      interaction: guard(ctx.interaction),
      author: guard(ctx.author),
      channel: guard(ctx.channel),
      guild: ctx.guild,
      // biome-ignore lint/suspicious/noExplicitAny: client.user shape is stable.
      me: guard((ctx.client as any).user),
      _: jsk.lastResult,
      vars: jsk.replVars,
      // Exposed so cooperative user code can pass it along (e.g. `fetch(url, { signal })`) or
      // poll `signal.aborted` in a loop, for cleaner cancellation than raceAbort alone gives.
      signal: controller.signal,
      // Bare `import(...)` inside a vm.Script requires an opt-in `importModuleDynamically`
      // callback, which itself requires Node's --experimental-vm-modules flag — not something
      // every djsk consumer's process can be expected to run with. This closure lives outside
      // the vm-executed code (in this file's normal module scope), so it can freely `import()`
      // without that restriction; eval'd code gets the same capability via `dynamicImport(...)`.
      //
      // `node:child_process` specifically comes back Proxy-wrapped so execSync/execFileSync/
      // spawnSync default to `evalTimeout` (see withDefaultTimeout) — this is the actual
      // interception point, not a global monkeypatch of the module: mutating the module object
      // reached via a default import (`import cp from 'node:child_process'`) does NOT affect
      // what a *named*/namespace import (what `dynamicImport` returns) sees, confirmed
      // experimentally — Node's synthetic ESM bindings for built-ins aren't reliably live
      // across that boundary, so patching has to happen right here instead.
      dynamicImport: async (specifier: string) => {
        const imported = await import(specifier)
        if (specifier !== 'node:child_process' && specifier !== 'child_process') return imported

        return new Proxy(imported, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver)
            return typeof prop === 'string' && GUARDED_CHILD_PROCESS_METHODS.has(prop)
              ? withDefaultTimeout(value, jsk.config.evalTimeout)
              : value
          },
        })
      },
    }
    const argNames = Object.keys(scope)
    const argValues = Object.values(scope)

    // In security mode, also guard the library's outbound methods (send/reply/edit/...) and,
    // where the library exposes one, its lower-level REST class — for the duration of the eval
    // — so arbitrary Discord calls (any channel/webhook/interaction, or a raw client.rest.post)
    // are scrubbed too.
    let restoreGuards: (() => void) | null = null
    let restoreRestGuard: (() => void) | null = null
    if (jsk.config.security) {
      const module = await loadLibraryModule()
      if (module) {
        restoreGuards = installPrototypeGuards(module, (text) => jsk.scrub(text))
        restoreRestGuard = installRestGuard(module, (text) => jsk.scrub(text))
      }
    }

    const task = jsk.submitTask('jsk js', () => controller.abort())
    // Unique per invocation (task.index is a monotonic counter) so concurrent evals can't
    // clobber each other's stashed arguments on the shared global object.
    const argsKey = `__djsk_eval_args_${task.index}__`
    // In security mode, also scrub what actually reaches the real terminal (not just the copy
    // captured for Discord) — otherwise a `console.log(client.token)` still leaks it into the
    // bot's own local logs, which may be shipped to a third-party service the operator doesn't
    // fully trust. Off by default (matches the general "token redaction is always on, full
    // scrubbing is opt-in" convention) so normal debugging output isn't silently altered.
    const capture = captureTerminalOutput(jsk.config.security ? (text) => jsk.scrub(text) : null)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: temporary bridge for vm.runInThisContext, deleted immediately below.
      ;(globalThis as any)[argsKey] = argValues

      let scriptResult: unknown
      try {
        const script = compile(code, argNames, argsKey)
        scriptResult = script.runInThisContext({
          timeout: jsk.config.evalTimeout,
          filename: 'jsk js',
        })
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException)?.code
        throw errorCode === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
          ? new EvalTimedOutError(jsk.config.evalTimeout)
          : error
      } finally {
        // biome-ignore lint/suspicious/noExplicitAny: temporary bridge for vm.runInThisContext.
        delete (globalThis as any)[argsKey]
      }

      const result = await raceAbort(Promise.resolve(scriptResult), controller.signal)
      const terminalOutput = capture.restore()

      if (jsk.retain) jsk.lastResult = result

      await ctx.react('✅')
      await sendResult(ctx, result, terminalOutput)
    } catch (error) {
      const terminalOutput = capture.restore()

      if (error instanceof EvalCancelledError) {
        // `jsk cancel` already sends its own confirmation — report only whatever terminal
        // output the eval produced before it was stopped, if any, rather than also surfacing
        // this as a generic error through Jishaku's catch-and-report handler.
        await ctx.react('🛑')
        if (terminalOutput) await sendResult(ctx, undefined, terminalOutput)
        return
      }

      if (error instanceof EvalTimedOutError) {
        await ctx.react('⏱️')
        await sendTerminalAndText(ctx, terminalOutput, error.message, 'output.js')
        return
      }

      throw error
    } finally {
      capture.restore()
      restoreRestGuard?.()
      restoreGuards?.()
      jsk.removeTask(task)
    }
  },
}

const retainCommand: Command = {
  name: 'retain',
  summary: 'Toggles REPL variable retention (the `vars` object and `_`). No arg shows status.',
  async handler(ctx) {
    const jsk = ctx.jsk
    const toggle = ctx.args[0]?.toLowerCase()

    if (toggle === undefined) {
      await ctx.send(`Variable retention is set to ${jsk.retain ? 'ON' : 'OFF'}.`)
      return
    }

    if (ENABLE.has(toggle)) {
      if (jsk.retain) {
        await ctx.send('Variable retention is already set to ON.')
        return
      }
      jsk.retain = true
      jsk.replVars = {}
      jsk.lastResult = null
      await ctx.send('Variable retention is ON. Assign to `vars` to persist across REPL sessions.')
      return
    }

    if (DISABLE.has(toggle)) {
      if (!jsk.retain) {
        await ctx.send('Variable retention is already set to OFF.')
        return
      }
      jsk.retain = false
      await ctx.send('Variable retention is OFF. Future REPL sessions will not retain their scope.')
      return
    }

    await ctx.send('Provide `on` or `off` (or nothing to see the current status).')
  },
}

export const jsCommands: Command[] = [jsCommand, retainCommand]
