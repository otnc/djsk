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
    { consoleLog: false, ...configOverrides },
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
