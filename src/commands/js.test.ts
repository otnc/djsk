import { describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'
import { jsCommands } from './js'

const jsCommand = jsCommands[0]

function makeJsk(security = false): Jishaku {
  return new Jishaku(
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    { token: 't0ken-fake' } as any,
    { consoleLog: false, security },
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
        makeJsk(true),
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
        makeJsk(false),
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
