import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildBaseScope,
  captureTerminalOutput,
  EvalCancelledError,
  installSecurityGuards,
  makeGuard,
  raceAbort,
  sendResult,
} from './eval-shared'
import type { Command } from './registry'

/** Subdirectory (under `evalModuleDir`) `jsk mjs` writes its transient per-eval file into. */
const TEMP_SUBDIR = '.djsk-tmp'

/**
 * Ensures `<baseDir>/.djsk-tmp` exists, dropping a `*` `.gitignore` into it the first time so
 * the transient eval files it holds don't show up in the host bot project's git status.
 */
function ensureTempDir(baseDir: string): string {
  const dir = path.join(baseDir, TEMP_SUBDIR)
  mkdirSync(dir, { recursive: true })
  const gitignore = path.join(dir, '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n')
  return dir
}

const mjsCommand: Command = {
  name: 'mjs',
  aliases: ['esm'],
  summary:
    'Evaluates JavaScript as a real ES module — `import` works. Use `export default` for a result.',
  /**
   * Unlike `jsk js`/`jsk cjs` (both run via `vm.Script`, see `compile()` in `eval-shared.ts`),
   * static `import` syntax cannot appear inside a function body at all — that's a hard
   * ECMAScript rule, not a `vm.Script` limitation. Real `import`/top-level `await` therefore
   * requires actually running the code as an ES module's top-level, which means going through
   * Node's real module loader via dynamic `import()`.
   *
   * That in turn requires a real file on disk, not a `data:` URL: verified experimentally that
   * `import()`-ing a `data:text/javascript,...` URL resolves `node:` builtins fine but fails to
   * resolve real npm packages (`Failed to resolve module specifier "..." ... Invalid relative
   * URL or base scheme is not hierarchical`), since a `data:` URL has no filesystem location
   * for Node's node_modules walk-up to start from. Writing the generated module to a temp file
   * under `evalModuleDir` (default `process.cwd()`, i.e. the *host bot's* project — not djsk's
   * own) gives the resolver a real location to walk up from, so bare imports of the host's own
   * dependencies work. The file is deleted again immediately after (`finally` below); only
   * `.djsk-tmp/` itself is left behind, reused across evals.
   *
   * Context variables (`client`, `message`, ...) can't be passed as function parameters here
   * (there's no wrapping function to receive them) — they're stashed on `globalThis` instead
   * and destructured by the generated module's first line, exactly like `jsk js`/`jsk cjs`
   * bridge their `vm.Script` arguments (see `compile()`), just via a real `const` statement
   * instead of a function call. `import`/`export` declarations are hoisted regardless of where
   * they appear in the module, so user code can freely `import` after that destructuring line.
   *
   * Trade-off, not fixed: because this doesn't go through `vm.Script`, there is no equivalent
   * of `EvalTimedOutError`'s synchronous-runaway protection here — a bare `while (true) {}` in
   * `jsk mjs` blocks the whole process with no recovery short of a restart. `jsk cancel` (via
   * `raceAbort`) still works for an eval stuck *awaiting* something, same as `js`/`cjs`.
   *
   * Trade-off, not fixed: `jsk js`/`jsk cjs`'s `dynamicImport(...)` scope global (see
   * `createDynamicImport` in `eval-shared.ts`) defaults a timeout onto `execSync`/
   * `execFileSync`/`spawnSync` when code fetches `node:child_process` through it. A real static
   * `import 'node:child_process'` here resolves through Node's actual module loader instead, so
   * it bypasses that wrapping entirely — there's no interception point for a *static* import
   * short of a process-wide custom ESM loader hook (`module.register(...)`), which would affect
   * every import in the host process, not just this eval's. Use `await
   * dynamicImport('node:child_process')` instead of a static import if the default timeout
   * matters for a particular eval.
   *
   * Trade-off, not fixed: the cache-busting query string below (needed since Node's ESM loader
   * has no API to evict a module once imported) means every `jsk mjs` call permanently grows
   * Node's module cache by one entry — a slow memory leak from ordinary (non-error) use of this
   * command over a long-running process's lifetime. Not fixable without either giving up real
   * top-level `import`/`await` support (this command's entire purpose) or requiring consumers
   * run with `--experimental-vm-modules` (see the `data:` URL trade-off above for why a
   * `vm.Script`-based approach isn't used instead).
   */
  async handler(ctx) {
    const code = ctx.codeblock.content
    if (!code.trim()) {
      await ctx.send('No code to evaluate.')
      return
    }

    const jsk = ctx.jsk
    const guard = makeGuard(ctx)
    const controller = new AbortController()
    const scope = buildBaseScope(ctx, guard, controller.signal)

    // Submitted before the (possibly awaiting) security-guard install below: `await` always
    // defers to a microtask tick even when the awaited call resolves synchronously, so
    // registering the task first guarantees it's visible in `jsk tasks`/cancellable via
    // `jsk cancel` immediately, without an extra tick's delay whenever security mode is off.
    const task = jsk.submitTask('jsk mjs', () => controller.abort())
    // Unique per invocation (task.index is a monotonic counter) so concurrent evals get their
    // own file and can't clobber each other's stashed arguments on the shared global object.
    const argsKey = `__djsk_eval_args_${task.index}__`
    // Declared here and populated inside the `try` below (rather than ahead of it) so a throw
    // from installSecurityGuards/captureTerminalOutput/ensureTempDir/writeFileSync still
    // reaches the `finally` — otherwise it would skip cleanup entirely: `capture`'s monkeypatch
    // of process.stdout/stderr.write would never be undone (permanently, until a restart),
    // security-mode guards would stay installed, and `task` would be a permanent ghost entry
    // in `jsk tasks`.
    let restoreGuards: (() => void) | null = null
    let restoreRestGuard: (() => void) | null = null
    let capture: ReturnType<typeof captureTerminalOutput> | null = null
    let file: string | null = null

    try {
      ;({ restoreGuards, restoreRestGuard } = await installSecurityGuards(ctx))
      capture = captureTerminalOutput(jsk.config.security ? (text) => jsk.scrub(text) : null)

      const dir = ensureTempDir(jsk.config.evalModuleDir)
      file = path.join(dir, `eval-${task.index}.mjs`)

      // biome-ignore lint/suspicious/noExplicitAny: temporary bridge for the generated module, deleted in the `finally` below.
      ;(globalThis as any)[argsKey] = scope

      const preamble = `const { ${Object.keys(scope).join(', ')} } = globalThis[${JSON.stringify(argsKey)}];\n`
      writeFileSync(file, preamble + code, 'utf-8')

      // Cache-busting query string so repeated evals of the same task-index-free filename
      // (or, after a restart, the same task index again) never serve a stale cached module.
      const namespace: Record<string, unknown> = await raceAbort(
        import(`${pathToFileURL(file).href}?t=${Date.now()}`),
        controller.signal,
      )

      const terminalOutput = capture.restore()
      const result = 'default' in namespace ? namespace.default : undefined

      if (jsk.retain) jsk.lastResult = result

      await ctx.react('✅')
      await sendResult(ctx, result, terminalOutput)
    } catch (error) {
      // `capture` can still be `null` here if the throw happened before terminal output
      // capture was even installed (e.g. installSecurityGuards or ensureTempDir itself threw).
      const terminalOutput = capture?.restore() ?? ''

      if (error instanceof EvalCancelledError) {
        // `jsk cancel` already sends its own confirmation — report only whatever terminal
        // output the eval produced before it was stopped, if any, rather than also surfacing
        // this as a generic error through Jishaku's catch-and-report handler.
        await ctx.react('🛑')
        if (terminalOutput) await sendResult(ctx, undefined, terminalOutput)
        return
      }

      throw error
    } finally {
      capture?.restore()
      restoreRestGuard?.()
      restoreGuards?.()
      jsk.removeTask(task)
      // biome-ignore lint/suspicious/noExplicitAny: temporary bridge for the generated module.
      delete (globalThis as any)[argsKey]
      if (file) {
        try {
          rmSync(file, { force: true })
        } catch {
          // Best-effort cleanup; a leftover temp file is harmless (and .gitignore'd).
        }
      }
    }
  },
}

export const mjsCommands: Command[] = [mjsCommand]
