import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'
import { cjsCommands } from './cjs'

const cjsCommand = cjsCommands[0]

function makeJsk(configOverrides: Record<string, unknown> = {}): Jishaku {
  return new Jishaku(
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    { token: 't0ken-fake' } as any,
    { consoleLog: false, catchProcessErrors: false, ...configOverrides },
  )
}

function makeContext(code: string, jsk: Jishaku = makeJsk()) {
  const send = vi.fn(async (payload: unknown) => ({ payload }))
  const react = vi.fn(async () => {})
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, react, author: {} } as any
  const source = { kind: 'message' as const, message }
  const ctx = new Context(jsk, source, 'cjs', code)
  return { ctx, send, react }
}

describe('jsk cjs — require', () => {
  it('resolves node: builtins via require', async () => {
    const { ctx, send } = makeContext('return typeof require("node:os").platform()')

    await cjsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('string')
  })

  it('still requires an explicit return — no auto-return', async () => {
    const { ctx, send } = makeContext('1 + 1')

    await cjsCommand.handler(ctx)

    expect(send).not.toHaveBeenCalled()
  })

  it("resolves require() relative to config.evalModuleDir, not djsk's own directory", async () => {
    // Simulate a host bot project by placing a resolvable package under a synthetic project
    // root's node_modules, then pointing evalModuleDir at that root.
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'djsk-cjs-host-'))
    const packageDir = path.join(projectRoot, 'node_modules', 'fake-pkg')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fake-pkg', version: '1.0.0', main: 'index.js' }),
    )
    writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = 42')

    try {
      const jsk = makeJsk({ evalModuleDir: projectRoot })
      const { ctx, send } = makeContext('return require("fake-pkg")', jsk)

      await cjsCommand.handler(ctx)

      const [payload] = send.mock.calls[0] as [{ content: string }]
      expect(payload.content).toBe('42')
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

describe('jsk cjs — blocking child_process calls via require', () => {
  it('kills an execSync call with no explicit timeout after evalTimeout, same as dynamicImport in jsk js', async () => {
    const jsk = makeJsk({ evalTimeout: 300 })
    const { ctx, react, send } = makeContext(
      // `await Promise.resolve()` closes out the vm.Script's initial synchronous stretch (the
      // only part `evalTimeout`'s watchdog actually times) before the blocking execSync call —
      // otherwise, since `require` (unlike `dynamicImport`) has no `await` of its own, the
      // watchdog would race execSync's own injected timeout and could trip first, which is a
      // separate, pre-existing characteristic of any fully-synchronous eval and not what this
      // test is about (see js.test.ts's equivalent dynamicImport-based test, which gets the
      // same effect for free from `await dynamicImport(...)`).
      `const cp = require("node:child_process")
       await Promise.resolve()
       try {
         cp.execSync(${JSON.stringify(process.execPath)} + ' -e "setTimeout(()=>{}, 3000)"')
         return 'ran to completion'
       } catch (e) {
         return e.code
       }`,
      jsk,
    )

    const start = Date.now()
    await cjsCommand.handler(ctx)
    const elapsed = Date.now() - start

    // Killed by the injected default timeout (~300ms), not left to run the full 3s — proves
    // require('child_process') is guarded the same way dynamicImport('node:child_process') is,
    // not just passed through as the raw, unwrapped module.
    expect(elapsed).toBeLessThan(2000)
    expect(react).toHaveBeenCalledWith('✅')
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('ETIMEDOUT')
  }, 10_000)

  it('does not mutate the real child_process module (only the require() result is wrapped)', async () => {
    const childProcess = await import('node:child_process')
    const originalExecSync = childProcess.execSync
    const jsk = makeJsk({ evalTimeout: 5000 })
    const { ctx } = makeContext('return typeof require("node:child_process").execSync', jsk)

    await cjsCommand.handler(ctx)

    expect(childProcess.execSync).toBe(originalExecSync)
  })

  it('preserves require.resolve/cache/main/extensions on the guarded require', async () => {
    const { ctx, send } = makeContext(
      `return [
         typeof require.resolve,
         typeof require.cache,
         typeof require.extensions,
       ].join(',')`,
    )

    await cjsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('function,object,object')
  })
})
