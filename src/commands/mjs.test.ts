import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'
import { mjsCommands } from './mjs'

const mjsCommand = mjsCommands[0]

function makeJsk(configOverrides: Record<string, unknown> = {}): Jishaku {
  return new Jishaku(
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    { token: 't0ken-fake' } as any,
    { consoleLog: false, catchProcessErrors: false, ...configOverrides },
  )
}

function makeContext(code: string, jsk: Jishaku) {
  const send = vi.fn(async (payload: unknown) => ({ payload }))
  const react = vi.fn(async () => {})
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, react, author: {} } as any
  const source = { kind: 'message' as const, message }
  const ctx = new Context(jsk, source, 'mjs', code)
  return { ctx, send, react }
}

describe('jsk mjs', () => {
  let projectRoot: string
  let jsk: Jishaku

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'djsk-mjs-host-'))
    jsk = makeJsk({ evalModuleDir: projectRoot })
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('supports real top-level import of a node: builtin', async () => {
    const { ctx, send } = makeContext(
      'import os from "node:os";\nexport default typeof os.platform();',
      jsk,
    )

    await mjsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('string')
  })

  it('resolves a real installed package via import, unlike a data: URL', async () => {
    const packageDir = path.join(projectRoot, 'node_modules', 'fake-esm-pkg')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fake-esm-pkg', version: '1.0.0', type: 'module', main: 'index.js' }),
    )
    writeFileSync(path.join(packageDir, 'index.js'), 'export default 42;')

    const { ctx, send } = makeContext(
      'import value from "fake-esm-pkg";\nexport default value;',
      jsk,
    )

    await mjsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('42')
  })

  it('uses `export default` (not `return`) to surface a result', async () => {
    const { ctx, send } = makeContext('return 1 + 1', jsk)

    // `return` at the top level of a module is a syntax error there, unlike in `jsk js`/`jsk
    // cjs` — confirming `jsk mjs` doesn't share their `return`-based result convention. (The
    // exact error type is loader-dependent — a real Node process throws `SyntaxError`, while
    // vitest's own Vite-based dynamic `import()` transform reports a `RolldownError` for the
    // same code — so this only asserts that it throws and never reaches `ctx.send`.)
    await expect(mjsCommand.handler(ctx)).rejects.toThrow(/return/i)
    expect(send).not.toHaveBeenCalled()
  })

  it('can access the injected scope (client, message, ...)', async () => {
    const { ctx, send } = makeContext('export default typeof client;', jsk)

    await mjsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('object')
  })

  it('writes its transient module file under evalModuleDir/.djsk-tmp and cleans it up after', async () => {
    const { ctx } = makeContext('export default 1;', jsk)

    await mjsCommand.handler(ctx)

    const tmpDir = path.join(projectRoot, '.djsk-tmp')
    expect(existsSync(tmpDir)).toBe(true)
    // Only the .gitignore should remain; the per-eval .mjs file is deleted afterward.
    expect(readdirSync(tmpDir)).toEqual(['.gitignore'])
  })

  it('cleans up the temp file even when the eval throws', async () => {
    const { ctx } = makeContext('throw new Error("boom");', jsk)

    await expect(mjsCommand.handler(ctx)).rejects.toThrow('boom')

    const tmpDir = path.join(projectRoot, '.djsk-tmp')
    expect(readdirSync(tmpDir)).toEqual(['.gitignore'])
  })

  describe('blocking child_process calls via a real static import', () => {
    it('kills an execSync call with no explicit timeout after evalTimeout', async () => {
      const timedJsk = makeJsk({ evalModuleDir: projectRoot, evalTimeout: 300 })
      const { ctx, react, send } = makeContext(
        `import cp from "node:child_process";
         let result;
         try {
           cp.execSync(${JSON.stringify(process.execPath)} + ' -e "setTimeout(()=>{}, 3000)"');
           result = 'ran to completion';
         } catch (e) {
           result = e.code;
         }
         export default result;`,
        timedJsk,
      )

      const start = Date.now()
      await mjsCommand.handler(ctx)
      const elapsed = Date.now() - start

      // Killed by the injected default timeout (~300ms), not left to run the full 3s — proves
      // a real static `import cp from "node:child_process"` is guarded too, not just
      // dynamicImport (jsk js) / require (jsk cjs).
      expect(elapsed).toBeLessThan(2000)
      expect(react).toHaveBeenCalledWith('✅')
      const [payload] = send.mock.calls[0] as [{ content: string }]
      expect(payload.content).toBe('ETIMEDOUT')
    }, 10_000)

    it('restores the real, shared child_process module once the eval finishes', async () => {
      const childProcess = await import('node:child_process')
      const originalExecSync = childProcess.execSync
      const { ctx, send } = makeContext(
        'import cp from "node:child_process";\nexport default typeof cp.execSync;',
        jsk,
      )

      await mjsCommand.handler(ctx)

      const [payload] = send.mock.calls[0] as [{ content: string }]
      expect(payload.content).toBe('function')
      expect(childProcess.execSync).toBe(originalExecSync)
    })
  })
})
