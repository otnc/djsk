import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'

// biome-ignore lint/suspicious/noExplicitAny: test-only fake ShellReader controlled per-test.
let fakeReaderImpl: (code: string, options: any) => any

vi.mock('../util/shell-reader', () => ({
  ShellReader: vi.fn(function ShellReader(this: unknown, code: string, options: unknown) {
    return fakeReaderImpl(code, options)
  }),
}))

const { shellCommands } = await import('./shell')
const { ShellReader } = await import('../util/shell-reader')
const shellCommand = shellCommands[0]

function makeJsk(configOverrides: Record<string, unknown> = {}): Jishaku {
  return new Jishaku(
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    { token: 't0ken-fake' } as any,
    { consoleLog: false, shellTimeout: 5000, ...configOverrides },
  )
}

function makeContext(code: string, jsk: Jishaku = makeJsk()) {
  const sentMessage = {
    react: vi.fn(async () => {}),
    edit: vi.fn(async (payload: unknown) => ({ ...sentMessage, payload })),
    createReactionCollector: vi.fn(() => new EventEmitter()),
  }
  const send = vi.fn(async (_payload: unknown) => sentMessage)
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, author: { id: 'owner-1' } } as any
  const source = { kind: 'message' as const, message }
  const ctx = new Context(jsk, source, 'sh', code)
  return { ctx, send, sentMessage }
}

/** Immediately "runs" the command, delivering `lines` synchronously then closing with `exitCode`. */
function stubReader(lines: string[], exitCode = 0) {
  fakeReaderImpl = (_code, options) => {
    for (const line of lines) options.onLine(line)
    return {
      ps1: 'PS >',
      highlight: 'powershell',
      done: Promise.resolve(exitCode),
      kill: vi.fn(),
    }
  }
}

describe('jsk sh — final output rendering', () => {
  it('sends a single tail message with no pagination when output fits', async () => {
    stubReader(['hello'])
    const { ctx, send, sentMessage } = makeContext('echo hello')

    await shellCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentMessage.react).not.toHaveBeenCalled()
  })

  it('paginates when the full output needs more than one page', async () => {
    stubReader(['x'.repeat(3000)])
    const { ctx, send, sentMessage } = makeContext('echo big')

    await shellCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentMessage.react).toHaveBeenCalledWith('⬅️')
    expect(sentMessage.react).toHaveBeenCalledWith('➡️')
  })

  it('falls back to a file attachment (in addition to the tail) for very large output', async () => {
    stubReader(['x'.repeat(25000)])
    const { ctx, send, sentMessage } = makeContext('echo huge')

    await shellCommand.handler(ctx)

    // one send for the (edited-in-place) tail message, one for the file attachment
    expect(send).toHaveBeenCalledTimes(2)
    const fileCall = send.mock.calls.find(
      (call) => (call[0] as { files?: unknown[] }).files !== undefined,
    )
    expect(fileCall).toBeDefined()
    expect(sentMessage.react).not.toHaveBeenCalled()
  })

  it('does not choke on a pathologically long command line (no hang, still responds)', async () => {
    stubReader(['x'.repeat(3000)])
    const { ctx, send } = makeContext(`echo ${'y'.repeat(5000)}`)

    await shellCommand.handler(ctx)

    expect(send).toHaveBeenCalled()
  })

  it('passes the configured shell override through to ShellReader', async () => {
    stubReader(['hi'])
    const shellOverride = { command: 'pwsh', args: ['-Command'] }
    const jsk = makeJsk({ shell: shellOverride })
    const { ctx } = makeContext('echo hi', jsk)

    await shellCommand.handler(ctx)

    const [, options] = vi.mocked(ShellReader).mock.calls.at(-1) as [string, { shell?: unknown }]
    expect(options.shell).toBe(shellOverride)
  })

  it('passes shell: null through when no override is configured', async () => {
    stubReader(['hi'])
    const { ctx } = makeContext('echo hi')

    await shellCommand.handler(ctx)

    const [, options] = vi.mocked(ShellReader).mock.calls.at(-1) as [string, { shell?: unknown }]
    expect(options.shell).toBeNull()
  })
})
