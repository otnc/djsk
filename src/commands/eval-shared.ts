import { createRequire } from 'node:module'
import vm from 'node:vm'
import type { Context } from '../context'
import { installPrototypeGuards, installRestGuard } from '../prototype-guard'
import { guardOutbound } from '../security'
import { inspectResult, MESSAGE_LIMIT, stripAnsi } from '../util/format'
import { loadLibraryModule } from '../util/meta'

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
 * Proxy-wraps a `node:child_process` module object so its execSync/execFileSync/spawnSync
 * default to `evalTimeoutMs` (see {@link withDefaultTimeout}) — the shared interception point
 * for both {@link createDynamicImport} and {@link createGuardedRequire}. Not a global
 * monkeypatch of the module: mutating the module object reached via a default import (`import
 * cp from 'node:child_process'`) does NOT affect what a named/namespace import or a fresh
 * `require('node:child_process')` sees, confirmed experimentally — Node hands out the same
 * live module object for `require`, but ESM bindings for built-ins aren't reliably live across
 * that boundary, so every consumer of this module needs its own wrap at its own entry point
 * rather than one shared patch.
 */
function guardChildProcessModule<T extends object>(module: T, evalTimeoutMs: number): T {
  return new Proxy(module, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      return typeof prop === 'string' && GUARDED_CHILD_PROCESS_METHODS.has(prop)
        ? // biome-ignore lint/suspicious/noExplicitAny: `T` is an opaque module shape here; the actual signature is forwarded verbatim by withDefaultTimeout.
          withDefaultTimeout(value as (...args: any[]) => any, evalTimeoutMs)
        : value
    },
  })
}

/**
 * Builds the `dynamicImport` scope entry shared by every eval flavor.
 *
 * Bare `import(...)` inside a `vm.Script` requires an opt-in `importModuleDynamically`
 * callback, which itself requires Node's --experimental-vm-modules flag — not something every
 * djsk consumer's process can be expected to run with. This closure lives outside the
 * vm-executed code (in normal module scope), so it can freely `import()` without that
 * restriction; eval'd code gets the same capability via `dynamicImport(...)`.
 *
 * `node:child_process` specifically comes back guarded via {@link guardChildProcessModule} — see
 * its doc comment for why this needs its own wrap rather than relying on a shared module patch.
 */
export function createDynamicImport(evalTimeoutMs: number) {
  return async (specifier: string) => {
    const imported = await import(specifier)
    return specifier === 'node:child_process' || specifier === 'child_process'
      ? guardChildProcessModule(imported, evalTimeoutMs)
      : imported
  }
}

/**
 * Wraps a real `require` (from `node:module`'s `createRequire`, used by `jsk cjs`) so
 * `require('child_process')`/`require('node:child_process')` also comes back guarded via
 * {@link guardChildProcessModule} — without this, `require` is a direct, unwrapped path to
 * Node's real child_process module that completely bypasses the timeout `dynamicImport` (see
 * above) defaults onto execSync/execFileSync/spawnSync, since `jsk cjs` code has no reason to
 * reach for `dynamicImport` when it already has a working `require`.
 *
 * `Object.assign`s the real `require`'s own properties (`resolve`, `cache`, `main`,
 * `extensions`) onto the wrapper, so code that relies on those (`require.resolve(...)`, etc.)
 * keeps working exactly as if it had the unwrapped `require`.
 */
export function createGuardedRequire(
  realRequire: NodeJS.Require,
  evalTimeoutMs: number,
): NodeJS.Require {
  const guarded = ((specifier: string) => {
    const resolved = realRequire(specifier)
    return specifier === 'node:child_process' || specifier === 'child_process'
      ? guardChildProcessModule(resolved, evalTimeoutMs)
      : resolved
  }) as NodeJS.Require
  return Object.assign(guarded, realRequire)
}

// Anchor path is arbitrary — only ever used to `require('node:child_process')`, a builtin that
// resolves without touching the filesystem, so it doesn't matter that this path may not exist.
const moduleRequire = createRequire(process.cwd())

/**
 * Temporarily patches the real, shared `node:child_process` module's execSync/execFileSync/
 * spawnSync with their `evalTimeoutMs`-guarded versions (see {@link withDefaultTimeout}),
 * returning a function that restores the originals.
 *
 * Exists for `jsk mjs` specifically: `dynamicImport(...)` (used by `jsk js`/`jsk cjs`, see
 * {@link createDynamicImport}) and `createGuardedRequire` (used by `jsk cjs`'s `require`) each
 * guard only what *they themselves* return, which works because eval'd code has to go through
 * one of those two functions to reach `node:child_process` in the first place. `jsk mjs`'s
 * generated module can instead reach it via a real static `import 'node:child_process'`, which
 * goes straight through Node's own loader with no per-call interception point available —
 * patching the shared module directly, before that generated module is ever imported, is the
 * only way to still guard it there.
 *
 * Confirmed experimentally (on both Node 22 and Node 24) that this — unlike mutating an
 * *already-obtained* module/namespace object after the fact, which is a different, negative
 * case (see {@link guardChildProcessModule}'s doc comment) — IS observed by a
 * subsequently-loaded module's `import`, whether default, named, or namespace: Node's synthetic
 * ESM bindings for `node:child_process` evidently bind live to the shared CommonJS
 * `module.exports` object (what `require('node:child_process')` returns), not a snapshot, as
 * long as the patch is in place before that module is first loaded.
 *
 * Global and single-owner, like the rest of djsk's eval guarding (see
 * `captureTerminalOutput`'s doc comment) — two concurrent `jsk mjs` evals installing/restoring
 * this at the same time would race and could hand one eval the other's timeout, an accepted
 * trade-off for a bot-owner debug tool rather than a general-purpose sandbox.
 */
export function installChildProcessTimeoutGuard(evalTimeoutMs: number): () => void {
  // biome-ignore lint/suspicious/noExplicitAny: mutating an opaque, dynamically-`require`d module object.
  const cp = moduleRequire('node:child_process') as Record<string, (...args: any[]) => any>
  const originals = new Map<string, (...args: unknown[]) => unknown>()

  for (const method of GUARDED_CHILD_PROCESS_METHODS) {
    const original = cp[method]
    originals.set(method, original)
    cp[method] = withDefaultTimeout(original, evalTimeoutMs)
  }

  return () => {
    for (const [method, original] of originals) {
      cp[method] = original
    }
  }
}

/**
 * Compiles user code into a `vm.Script` whose top-level statement immediately invokes an
 * async function taking `argNames` as parameters, applied to whatever's stashed at
 * `globalThis[argsKey]` at call time.
 *
 * Run via `runInThisContext()` — the *current* realm, not a new sandboxed one — so it behaves
 * exactly like a plain `AsyncFunction`: full access to Node's ambient globals, and live object
 * references (client, message, ...) passed as args work unchanged, with no serialization
 * boundary. The difference is that `Script#runInThisContext` accepts a `timeout`, which
 * `AsyncFunction` calls never could — see {@link EvalTimedOutError}.
 *
 * Always a statement body — the user is expected to `return` explicitly. (An earlier version
 * of this also tried parsing the code as a single auto-returning expression first; dropped so
 * `return` is always required, with no auto-return surprises.)
 */
export function compile(
  code: string,
  argNames: string[],
  argsKey: string,
  filename: string,
): vm.Script {
  const params = argNames.join(', ')
  const invocation = `.apply(null, globalThis[${JSON.stringify(argsKey)}])`
  return new vm.Script(`(async function (${params}) {\n${code}\n})${invocation}`, { filename })
}

// biome-ignore lint/suspicious/noExplicitAny: structural Message check across libraries.
export function isMessage(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'author' in value &&
    typeof value.react === 'function' &&
    ('url' in value || 'id' in value)
  )
}

/** Thrown to unwind an eval that was stopped via `jsk cancel`. */
export class EvalCancelledError extends Error {
  constructor() {
    super('Cancelled via jsk cancel.')
    this.name = 'EvalCancelledError'
  }
}

/**
 * Thrown when a synchronous stretch of a `vm.Script`-based eval (e.g. a bare `while (true) {}`)
 * ran longer than `evalTimeout` and was forcibly terminated by V8's execution watchdog —
 * confirmed experimentally to genuinely preempt a tight JS loop, unlike JS-level cooperative
 * cancellation (V8 checks for a pending termination request at loop back-edges/calls during
 * actual bytecode execution, so this doesn't require the running code to yield).
 *
 * Unlike {@link EvalCancelledError}, this can't be triggered by `jsk cancel` reactively —
 * while the eval is stuck in synchronous code, the whole bot process is blocked (nothing else
 * runs either, including processing a cancel request), so there's no "react to the command"
 * moment available. `evalTimeout` is a hard cap enforced up front instead.
 *
 * Only applies to `jsk js`/`jsk cjs` (both run via `vm.Script`). `jsk mjs` runs as a real ES
 * module via a genuine dynamic `import()` instead, which has no equivalent timeout mechanism —
 * a synchronous runaway there blocks the process with no recovery short of a restart. See the
 * doc comment on `jsk mjs`'s handler.
 *
 * Known gap: this covers synchronous *JS* execution, not a blocking *native* call the code
 * might make (e.g. `child_process.execSync` on a slow command) — confirmed experimentally that
 * such a call is NOT interrupted by the timeout, since V8's watchdog only preempts during
 * bytecode execution, not while parked waiting on a native/libuv call to return. Short of
 * restarting the process, there's currently no way around that; it would need running the eval
 * in a separate thread that can be forcibly terminated (`node:worker_threads`), which isn't
 * viable here without losing direct, synchronous access to the live client/message/channel
 * objects the vm-based evals are built around (they aren't structured-cloneable across a
 * worker boundary).
 */
export class EvalTimedOutError extends Error {
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
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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
 * Temporarily wraps `process.stdout`/`process.stderr`'s `write()`, so an eval command can
 * surface everything written to the terminal during its run — not just `console.*` (which
 * itself writes through these same streams under the hood), but also raw
 * `process.stdout.write()` calls and output from any library the user code touches.
 * `restore()` undoes the wrapping and returns the captured text; safe to call more than once.
 *
 * `scrub`, when given (security mode), is also applied to what actually reaches the real
 * stream — not just the copy captured here for Discord — so a `console.log(client.token)`
 * doesn't leak the token into the bot's own local output/logs either. `null` (the default
 * outside security mode) leaves real output completely untouched, unchanged from before.
 *
 * This patches the process-wide streams for the eval's duration, so two evals running
 * concurrently would see each other's output in their capture — an accepted trade-off for a
 * single-owner debug tool.
 */
export function captureTerminalOutput(scrub: ((text: string) => string) | null): {
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
export async function sendTerminalAndText(
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

export async function sendResult(
  ctx: Context,
  result: unknown,
  terminalOutput: string,
): Promise<void> {
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

/** The common `client`/`message`/... variables injected into every eval flavor's scope. */
export function buildBaseScope(
  ctx: Context,
  guard: (value: unknown) => unknown,
  controllerSignal: AbortSignal,
): Record<string, unknown> {
  const jsk = ctx.jsk
  return {
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
    signal: controllerSignal,
    dynamicImport: createDynamicImport(jsk.config.evalTimeout),
  }
}

/**
 * In security mode, hands the eval scope guarded objects so user code that sends/replies/edits
 * (message, channel, DMs, interactions reachable through them) is scrubbed too.
 */
export function makeGuard(ctx: Context): (value: unknown) => unknown {
  const jsk = ctx.jsk
  return (value: unknown) =>
    jsk.config.security && value && typeof value === 'object'
      ? guardOutbound(value, (text) => jsk.scrub(text))
      : value
}

/**
 * In security mode, also guards the library's outbound methods (send/reply/edit/...) and,
 * where the library exposes one, its lower-level REST class — for the duration of a single
 * eval — so arbitrary Discord calls (any channel/webhook/interaction, or a raw client.rest.post)
 * are scrubbed too. Returns the restore functions to call in a `finally`.
 */
export async function installSecurityGuards(
  ctx: Context,
): Promise<{ restoreGuards: (() => void) | null; restoreRestGuard: (() => void) | null }> {
  const jsk = ctx.jsk
  if (!jsk.config.security) return { restoreGuards: null, restoreRestGuard: null }

  const module = await loadLibraryModule()
  if (!module) return { restoreGuards: null, restoreRestGuard: null }

  return {
    restoreGuards: installPrototypeGuards(module, (text) => jsk.scrub(text)),
    restoreRestGuard: installRestGuard(module, (text) => jsk.scrub(text)),
  }
}

/**
 * Runs `code` through the shared `vm.Script`-based eval engine (see {@link compile}) — the
 * common path behind both `jsk js` and `jsk cjs`, which differ only in `extraScope` (`cjs`
 * adds `require`) and `taskName` (shown in `jsk tasks`/used as the script's filename).
 *
 * Handles task registration/cancellation, terminal output capture, security guarding, the
 * `evalTimeout` synchronous watchdog, and reporting the result/error back to Discord.
 */
export async function runVmEval(
  ctx: Context,
  code: string,
  extraScope: Record<string, unknown>,
  taskName: string,
): Promise<void> {
  if (!code.trim()) {
    await ctx.send('No code to evaluate.')
    return
  }

  const jsk = ctx.jsk
  const guard = makeGuard(ctx)
  const controller = new AbortController()
  const scope: Record<string, unknown> = {
    ...buildBaseScope(ctx, guard, controller.signal),
    ...extraScope,
  }
  const argNames = Object.keys(scope)
  const argValues = Object.values(scope)

  // Submitted before the (possibly awaiting) security-guard install below: `await` always
  // defers to a microtask tick even when the awaited call resolves synchronously, so
  // registering the task first guarantees it's visible in `jsk tasks`/cancellable via
  // `jsk cancel` immediately, without an extra tick's delay whenever security mode is off.
  const task = jsk.submitTask(taskName, () => controller.abort())
  // Unique per invocation (task.index is a monotonic counter) so concurrent evals can't
  // clobber each other's stashed arguments on the shared global object.
  const argsKey = `__djsk_eval_args_${task.index}__`
  // Declared here (rather than as `const` from a destructured `await` above) and populated
  // inside the `try` below, so a throw from `installSecurityGuards`/`captureTerminalOutput`
  // itself still reaches the `finally` — otherwise such a throw would skip `jsk.removeTask`
  // entirely, leaking `task` as a permanent ghost entry in `jsk tasks`.
  let restoreGuards: (() => void) | null = null
  let restoreRestGuard: (() => void) | null = null
  let capture: ReturnType<typeof captureTerminalOutput> | null = null
  try {
    ;({ restoreGuards, restoreRestGuard } = await installSecurityGuards(ctx))
    // In security mode, also scrub what actually reaches the real terminal (not just the copy
    // captured for Discord) — otherwise a `console.log(client.token)` still leaks it into the
    // bot's own local logs, which may be shipped to a third-party service the operator doesn't
    // fully trust. Off by default (matches the general "token redaction is always on, full
    // scrubbing is opt-in" convention) so normal debugging output isn't silently altered.
    capture = captureTerminalOutput(jsk.config.security ? (text) => jsk.scrub(text) : null)

    // biome-ignore lint/suspicious/noExplicitAny: temporary bridge for vm.runInThisContext, deleted immediately below.
    ;(globalThis as any)[argsKey] = argValues

    let scriptResult: unknown
    try {
      const script = compile(code, argNames, argsKey, taskName)
      scriptResult = script.runInThisContext({
        timeout: jsk.config.evalTimeout,
        filename: taskName,
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
    // `capture` can still be `null` here if the throw came from `installSecurityGuards` itself,
    // before terminal output capture was even installed.
    const terminalOutput = capture?.restore() ?? ''

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
    capture?.restore()
    restoreRestGuard?.()
    restoreGuards?.()
    jsk.removeTask(task)
  }
}
