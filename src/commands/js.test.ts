import { describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'
import { jsCommands } from './js'

const jsCommand = jsCommands[0]

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
  const ctx = new Context(jsk, source, 'js', code)
  return { ctx, send, react }
}

// vitest patches the global `console` for its own per-test reporting, so `console.log` inside
// these tests doesn't reach the real `process.stdout.write` the way it does in a real bot
// process. Writing to `process.stdout` directly (as these tests do) exercises the exact layer
// `captureTerminalOutput` patches, regardless of test-runner console shenanigans — and, since
// it isn't `console.*`, it also proves capture isn't limited to console output.
describe('jsk js — terminal output capture', () => {
  it('includes raw process.stdout.write output alongside the eval result in the (single) reply', async () => {
    const { ctx, send } = makeContext('process.stdout.write("hello from eval\\n"); return 1 + 1')

    await jsCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('hello from eval')
    expect(payload.content).toContain('2')
  })

  it('captures process.stderr.write output too', async () => {
    const { ctx, send } = makeContext('process.stderr.write("uh oh\\n")')

    await jsCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('uh oh')
  })

  it('still sends terminal output when there is no return value', async () => {
    const { ctx, send } = makeContext('process.stdout.write("side effect only\\n")')

    await jsCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('side effect only')
  })

  it('sends nothing when there is neither terminal output nor a result', async () => {
    const { ctx, send } = makeContext('const x = 1')

    await jsCommand.handler(ctx)

    expect(send).not.toHaveBeenCalled()
  })

  it('restores process.stdout.write after the eval even if user code throws', async () => {
    const original = process.stdout.write
    const { ctx } = makeContext('throw new Error("boom")')

    await expect(jsCommand.handler(ctx)).rejects.toThrow('boom')

    expect(process.stdout.write).toBe(original)
  })

  it('redacts the client token from captured terminal output regardless of security mode', async () => {
    const { ctx, send } = makeContext('process.stdout.write(client.token)')

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).not.toContain('t0ken-fake')
    expect(payload.content).toContain('[token omitted]')
  })

  it('applies full secret scrubbing to captured terminal output in security mode', async () => {
    process.env.JS_TEST_SECRET_KEY = 'super-secret-value-123456'
    try {
      const { ctx, send } = makeContext(
        'process.stdout.write(process.env.JS_TEST_SECRET_KEY)',
        makeJsk({ security: true }),
      )

      await jsCommand.handler(ctx)

      const [payload] = send.mock.calls[0] as [{ content: string }]
      expect(payload.content).not.toContain('super-secret-value-123456')
      expect(payload.content).toContain('[redacted]')
    } finally {
      delete process.env.JS_TEST_SECRET_KEY
    }
  })

  it('does not scrub non-token secrets when security mode is off', async () => {
    process.env.JS_TEST_SECRET_KEY_2 = 'another-secret-value-654321'
    try {
      const { ctx, send } = makeContext(
        'process.stdout.write(process.env.JS_TEST_SECRET_KEY_2)',
        makeJsk({ security: false }),
      )

      await jsCommand.handler(ctx)

      const [payload] = send.mock.calls[0] as [{ content: string }]
      expect(payload.content).toContain('another-secret-value-654321')
    } finally {
      delete process.env.JS_TEST_SECRET_KEY_2
    }
  })
})

describe('jsk js — cancellation', () => {
  it('registers a cancellable task while the eval is running', async () => {
    const { ctx } = makeContext('await new Promise(() => {})')
    const handlerPromise = jsCommand.handler(ctx)

    expect(ctx.jsk.tasks).toHaveLength(1)
    expect(ctx.jsk.tasks[0].command).toBe('jsk js')
    expect(ctx.jsk.tasks[0].cancel).toBeTypeOf('function')

    ctx.jsk.tasks[0].cancel?.()
    await handlerPromise
  })

  it('reports a clean cancellation instead of hanging when jsk cancel aborts it', async () => {
    const { ctx, react, send } = makeContext('await new Promise(() => {})')
    const handlerPromise = jsCommand.handler(ctx)

    ctx.jsk.tasks[0].cancel?.()
    await expect(handlerPromise).resolves.toBeUndefined()

    expect(react).toHaveBeenCalledWith('🛑')
    expect(react).not.toHaveBeenCalledWith('✅')
    expect(ctx.jsk.tasks).toHaveLength(0)
    // No terminal output was produced before cancelling, so there's nothing to send.
    expect(send).not.toHaveBeenCalled()
  })

  it('still reports terminal output produced before the cancellation', async () => {
    const { ctx, send } = makeContext(
      'process.stdout.write("partial\\n"); await new Promise(() => {})',
    )
    const handlerPromise = jsCommand.handler(ctx)

    ctx.jsk.tasks[0].cancel?.()
    await handlerPromise

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('partial')
  })

  it('exposes an AbortSignal in the eval scope for cooperative cancellation', async () => {
    const { ctx, send } = makeContext('return signal instanceof AbortSignal')

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('true')
  })

  it('leaves other errors (not a cancellation) to propagate normally', async () => {
    const { ctx, react } = makeContext('throw new Error("boom")')

    await expect(jsCommand.handler(ctx)).rejects.toThrow('boom')

    expect(react).not.toHaveBeenCalledWith('🛑')
  })
})

describe('jsk js — dynamicImport', () => {
  it('lets eval code dynamically import a module without --experimental-vm-modules', async () => {
    const { ctx, send } = makeContext(
      'const os = await dynamicImport("node:os"); return typeof os.platform()',
    )

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('string')
  })
})

describe('jsk js — blocking child_process calls', () => {
  it('kills an execSync call with no explicit timeout after evalTimeout', async () => {
    const jsk = makeJsk({ evalTimeout: 300 })
    const { ctx, react, send } = makeContext(
      `const cp = await dynamicImport("node:child_process")
       try {
         cp.execSync(${JSON.stringify(process.execPath)} + ' -e "setTimeout(()=>{}, 3000)"')
         return 'ran to completion'
       } catch (e) {
         return e.code
       }`,
      jsk,
    )

    const start = Date.now()
    await jsCommand.handler(ctx)
    const elapsed = Date.now() - start

    // Killed by the injected default timeout (~300ms), not left to run the full 3s.
    expect(elapsed).toBeLessThan(2000)
    expect(react).toHaveBeenCalledWith('✅')
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('ETIMEDOUT')
  }, 10_000)

  it('does not override a timeout the eval code set explicitly', async () => {
    const jsk = makeJsk({ evalTimeout: 5000 })
    const { ctx, react, send } = makeContext(
      `const cp = await dynamicImport("node:child_process")
       try {
         cp.execSync(${JSON.stringify(process.execPath)} + ' -e "setTimeout(()=>{}, 3000)"', { timeout: 200 })
         return 'ran to completion'
       } catch (e) {
         return e.code
       }`,
      jsk,
    )

    const start = Date.now()
    await jsCommand.handler(ctx)
    const elapsed = Date.now() - start

    // Killed at ~200ms (the eval's own explicit timeout), well under the 5000ms evalTimeout —
    // proves the default injection didn't clobber the caller's own value.
    expect(elapsed).toBeLessThan(2000)
    expect(react).toHaveBeenCalledWith('✅')
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('ETIMEDOUT')
  }, 10_000)

  it('does not mutate the real child_process module (only the dynamicImport result is wrapped)', async () => {
    const childProcess = await import('node:child_process')
    const originalExecSync = childProcess.execSync
    const jsk = makeJsk({ evalTimeout: 5000 })
    const { ctx } = makeContext(
      'const cp = await dynamicImport("node:child_process"); return typeof cp.execSync',
      jsk,
    )

    await jsCommand.handler(ctx)

    expect(childProcess.execSync).toBe(originalExecSync)
  })

  it('leaves unguarded child_process exports (e.g. exec) passing through unwrapped', async () => {
    const jsk = makeJsk({ evalTimeout: 5000 })
    const { ctx, send } = makeContext(
      'const cp = await dynamicImport("node:child_process"); return typeof cp.exec',
      jsk,
    )

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('function')
  })
})

describe('jsk js — synchronous runaway (evalTimeout)', () => {
  it('terminates a bare while(true) loop instead of hanging the process forever', async () => {
    const jsk = makeJsk({ evalTimeout: 100 })
    const { ctx, react, send } = makeContext('while (true) {}', jsk)

    await jsCommand.handler(ctx)

    expect(react).toHaveBeenCalledWith('⏱️')
    expect(react).not.toHaveBeenCalledWith('✅')
    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('Synchronous execution exceeded')
    expect(payload.content).toContain('100ms')
  }, 10_000)

  it('recovers cleanly afterwards — a later eval still runs fine', async () => {
    const jsk = makeJsk({ evalTimeout: 100 })
    const timedOut = makeContext('while (true) {}', jsk)
    await jsCommand.handler(timedOut.ctx)

    const following = makeContext('return 1 + 1', jsk)
    await jsCommand.handler(following.ctx)

    const [payload] = following.send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('2')
  }, 10_000)

  it('includes terminal output written before the loop started', async () => {
    const jsk = makeJsk({ evalTimeout: 100 })
    const { ctx, send } = makeContext(
      'process.stdout.write("before the loop\\n"); while (true) {}',
      jsk,
    )

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('before the loop')
  }, 10_000)

  it('removes the task after timing out, so it no longer shows up in jsk tasks', async () => {
    const jsk = makeJsk({ evalTimeout: 100 })
    const { ctx } = makeContext('while (true) {}', jsk)

    await jsCommand.handler(ctx)

    expect(jsk.tasks).toHaveLength(0)
  }, 10_000)

  it('does not time out an eval that only awaits (no sync runaway)', async () => {
    const jsk = makeJsk({ evalTimeout: 100 })
    const { ctx, send } = makeContext(
      'await new Promise((r) => setTimeout(r, 300)); return "done"',
      jsk,
    )

    await jsCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toBe('done')
  }, 10_000)
})
