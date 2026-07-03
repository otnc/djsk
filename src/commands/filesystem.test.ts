import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '../context'
import { Jishaku } from '../jishaku'
import { filesystemCommands } from './filesystem'

const catCommand = filesystemCommands[0]
const curlCommand = filesystemCommands[1]

function makeJsk(): Jishaku {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
  return new Jishaku({ token: 't0ken-fake' } as any, { consoleLog: false })
}

function makeContext(command: string, args: string) {
  const send = vi.fn(async (payload: unknown) => ({ payload }))
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, author: {} } as any
  const source = { kind: 'message' as const, message }
  const ctx = new Context(makeJsk(), source, command, args)
  return { ctx, send }
}

describe('jsk cat — line span validation', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'djsk-cat-'))
    filePath = join(dir, 'file.txt')
    await writeFile(filePath, 'one\ntwo\nthree\n', 'utf-8')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a valid line span', async () => {
    const { ctx, send } = makeContext('cat', `${filePath}#L2-3`)

    await catCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('two')
    expect(payload.content).toContain('three')
    expect(payload.content).not.toContain('one')
  })

  it('rejects #L0 instead of silently returning the last line', async () => {
    const { ctx, send } = makeContext('cat', `${filePath}#L0`)

    await catCommand.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [string]
    expect(payload).toContain('Line numbers must start at 1')
  })

  it('rejects a range end before its start', async () => {
    const { ctx, send } = makeContext('cat', `${filePath}#L5-2`)

    await catCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [string]
    expect(payload).toContain('Line numbers must start at 1')
  })
})

describe('jsk curl — timeout and size guarding', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllGlobals()
  })

  it('reports a timeout instead of hanging when the request is aborted', async () => {
    global.fetch = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          const error = new Error('The operation was aborted due to timeout')
          error.name = 'TimeoutError'
          reject(error)
        }),
    ) as unknown as typeof fetch

    const { ctx, send } = makeContext('curl', 'https://example.com/slow')

    await curlCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [string]
    expect(payload).toContain('timed out')
  })

  it('refuses a response whose declared Content-Length exceeds the cap without downloading it', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('', {
          status: 200,
          headers: { 'content-length': String(50 * 1024 * 1024) },
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const { ctx, send } = makeContext('curl', 'https://example.com/huge')

    await curlCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [string]
    expect(payload).toContain('Refusing to download')
  })

  it('cuts off a response that exceeds the cap even without an accurate Content-Length', async () => {
    // No content-length header at all — the streamed-byte cap must still catch this.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(9 * 1024 * 1024).fill(97)) // 9 MiB, over the 8 MiB cap
        controller.close()
      },
    })
    global.fetch = vi.fn(
      async () => new Response(stream, { status: 200 }),
    ) as unknown as typeof fetch

    const { ctx, send } = makeContext('curl', 'https://example.com/unbounded')

    await curlCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [string]
    expect(payload).toContain('Refusing to download')
  })

  it('downloads and displays a normal response', async () => {
    global.fetch = vi.fn(
      async () => new Response('hello from the internet', { status: 200 }),
    ) as unknown as typeof fetch

    const { ctx, send } = makeContext('curl', 'https://example.com/ok')

    await curlCommand.handler(ctx)

    const [payload] = send.mock.calls[0] as [{ content: string }]
    expect(payload.content).toContain('hello from the internet')
  })
})
