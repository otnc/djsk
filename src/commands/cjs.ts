import { createRequire } from 'node:module'
import path from 'node:path'
import { createGuardedRequire, runVmEval } from './eval-shared'
import type { Command } from './registry'

const cjsCommand: Command = {
  name: 'cjs',
  aliases: ['commonjs'],
  summary: 'Evaluates JavaScript with `require` available. Use `return` to produce a result.',
  async handler(ctx) {
    // `createRequire` only needs a directory to anchor resolution from — the filename need not
    // exist. Anchored at `evalModuleDir` (default `process.cwd()`) rather than djsk's own
    // package directory, so `require(...)` resolves the *host bot's* node_modules and files,
    // not djsk's.
    const realRequire = createRequire(path.join(ctx.jsk.config.evalModuleDir, 'jsk-eval-shim.cjs'))
    // Guarded (not the raw `require`) so `require('child_process')` also gets the same
    // execSync/execFileSync/spawnSync default-timeout protection `dynamicImport` gives —
    // otherwise `require`, being the natural way `jsk cjs` code reaches for child_process,
    // would silently bypass it. See `createGuardedRequire`'s doc comment in eval-shared.ts.
    const require = createGuardedRequire(realRequire, ctx.jsk.config.evalTimeout)
    await runVmEval(ctx, ctx.codeblock.content, { require }, 'jsk cjs')
  },
}

export const cjsCommands: Command[] = [cjsCommand]
