import vm from 'node:vm'
import type { Context } from '../context'
import { installPrototypeGuards } from '../prototype-guard'
import { guardOutbound } from '../security'
import { inspectResult } from '../util/format'
import { loadLibraryModule } from '../util/meta'
import type { Command } from './registry'

const ENABLE = new Set(['on', 'true', 't', 'yes', 'y', '1', 'enable'])
const DISABLE = new Set(['off', 'false', 'f', 'no', 'n', '0', 'disable'])

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
 * longer than `evalTimeout` and was forcibly terminated by V8's execution watchdog.
 *
 * Unlike {@link EvalCancelledError}, this can't be triggered by `jsk cancel` reactively —
 * while the eval is stuck in synchronous code, the whole bot process is blocked (nothing else
 * runs either, including processing a cancel request), so there's no "react to the command"
 * moment available. `evalTimeout` is a hard cap enforced up front instead.
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
 * started, e.g. a pending `fetch`): JS can't preempt a synchronous stretch of code (an
 * unconditional `while (true) {}` blocks the event loop entirely, so nothing — this included —
 * runs until it returns control). It does, however, cover the far more common "hang" shape:
 * an eval stuck awaiting something that never resolves (an infinite retry loop with an
 * `await` in it, a Discord call that never comes back, `await new Promise(() => {})`, ...).
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
 * calls and output from any library the user code touches. Real output keeps flowing through
 * unchanged. `restore()` undoes the wrapping and returns the captured text; safe to call more
 * than once.
 *
 * This patches the process-wide streams for the eval's duration, so two `jsk js` evals
 * running concurrently would see each other's output in their capture — an accepted
 * trade-off for a single-owner debug tool.
 */
function captureTerminalOutput(): { restore: () => string } {
  const chunks: string[] = []
  const originalStdoutWrite: WriteFn = process.stdout.write
  const originalStderrWrite: WriteFn = process.stderr.write

  // Calls the original via `.apply(stream, ...)` rather than a pre-bound reference, so
  // `restore()` can put back the exact original function (not a `.bind()` wrapper around
  // it) — otherwise repeated eval calls would pile up an ever-growing chain of bound wrappers.
  const wrap =
    (stream: NodeJS.WriteStream, original: WriteFn): WriteFn =>
    (chunk: unknown, ...rest: unknown[]) => {
      chunks.push(
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf-8')
            : String(chunk),
      )
      // biome-ignore lint/suspicious/noExplicitAny: forwarding Node's overloaded write(chunk, encoding?, callback?) verbatim.
      return (original as any).apply(stream, [chunk, ...rest])
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

async function sendResult(ctx: Context, result: unknown, terminalOutput: string): Promise<void> {
  const resultText = isMessage(result)
    ? // biome-ignore lint/suspicious/noExplicitAny: verified Message-like above.
      `<Message ${(result as any).url ?? (result as any).id}>`
    : result === undefined
      ? null
      : inspectResult(result)

  const parts: string[] = []
  if (terminalOutput) parts.push(`\`\`\`\n${terminalOutput}\n\`\`\``)
  if (resultText !== null) parts.push(resultText)
  if (parts.length === 0) return

  // Routed through ctx.sendResult (not a raw send) so the captured terminal output gets the
  // same token redaction / security-mode secret scrubbing as everything else djsk sends.
  await ctx.sendResult(parts.join('\n'), 'output.js')
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
    }
    const argNames = Object.keys(scope)
    const argValues = Object.values(scope)

    // In security mode, also guard the library's outbound methods for the duration of the eval
    // so arbitrary Discord calls (any channel/webhook/interaction, raw REST wrappers) are scrubbed.
    let restoreGuards: (() => void) | null = null
    if (jsk.config.security) {
      const module = await loadLibraryModule()
      if (module) restoreGuards = installPrototypeGuards(module, (text) => jsk.scrub(text))
    }

    const task = jsk.submitTask('jsk js', () => controller.abort())
    // Unique per invocation (task.index is a monotonic counter) so concurrent evals can't
    // clobber each other's stashed arguments on the shared global object.
    const argsKey = `__djsk_eval_args_${task.index}__`
    const capture = captureTerminalOutput()
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
        const parts = terminalOutput
          ? [`\`\`\`\n${terminalOutput}\n\`\`\``, error.message]
          : [error.message]
        await ctx.sendResult(parts.join('\n'), 'output.js')
        return
      }

      throw error
    } finally {
      capture.restore()
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
