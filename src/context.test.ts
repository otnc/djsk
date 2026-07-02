import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { Context } from './context'
import { Jishaku } from './jishaku'

function makeJsk(): Jishaku {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
  return new Jishaku({ token: 't0ken-fake' } as any, { consoleLog: false })
}

function makeMessageSource(overrides: { reply?: ReturnType<typeof vi.fn> } = {}) {
  const send = vi.fn(async (payload: unknown) => ({ payload }))
  const reply = overrides.reply ?? vi.fn(async (payload: unknown) => ({ payload }))
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, reply } as any
  return { source: { kind: 'message' as const, message }, send, reply }
}

/** A message source whose `channel.send` resolves to a message reactable/editable enough
 * for pagination — {@link paginate}'s own behaviour is covered separately in paginate.test.ts. */
function makeReactableMessageSource() {
  const sentMessage = {
    react: vi.fn(async () => {}),
    edit: vi.fn(async (payload: unknown) => ({ payload })),
    createReactionCollector: vi.fn(() => new EventEmitter()),
  }
  const send = vi.fn(async (_payload: unknown) => sentMessage)
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake message for tests.
  const message = { channel: { send }, author: { id: 'owner-1' } } as any
  return { source: { kind: 'message' as const, message }, send, sentMessage }
}

describe('Context.send / Context.reply — empty-payload guard', () => {
  it('substitutes a zero-width space for a bare empty string', async () => {
    const jsk = makeJsk()
    const { source, send } = makeMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.send('')

    expect(send).toHaveBeenCalledWith('​')
  })

  it('leaves non-empty string payloads untouched', async () => {
    const jsk = makeJsk()
    const { source, send } = makeMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.send('hi')

    expect(send).toHaveBeenCalledWith('hi')
  })

  it('adds placeholder content to an object payload with no content/files/embeds', async () => {
    const jsk = makeJsk()
    const { source, send } = makeMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.send({ allowedMentions: { parse: [] } })

    expect(send).toHaveBeenCalledWith({ allowedMentions: { parse: [] }, content: '​' })
  })

  it('does not touch an object payload that already carries embeds', async () => {
    const jsk = makeJsk()
    const { source, send } = makeMessageSource()
    const ctx = new Context(jsk, source, 'js', '')
    const payload = { embeds: [{ title: 'ok' }] }

    await ctx.send(payload)

    expect(send).toHaveBeenCalledWith(payload)
  })

  it('guards reply() the same way, avoiding DiscordAPIError[50006]', async () => {
    const jsk = makeJsk()
    const { source, reply } = makeMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.reply('')

    expect(reply).toHaveBeenCalledWith('​')
  })
})

describe('Context.sendResult — pagination', () => {
  it('sends short content directly with no reactions', async () => {
    const jsk = makeJsk()
    const { source, send, sentMessage } = makeReactableMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.sendResult('short result')

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentMessage.react).not.toHaveBeenCalled()
  })

  it('paginates content over the message limit instead of falling back to a file', async () => {
    const jsk = makeJsk()
    const { source, send, sentMessage } = makeReactableMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.sendResult('x'.repeat(3000))

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ content: string; files?: unknown }]
    expect(payload.files).toBeUndefined()
    expect(payload.content).toContain('-- Page 1/2 --')
    expect(sentMessage.react).toHaveBeenCalledWith('⬅️')
    expect(sentMessage.react).toHaveBeenCalledWith('➡️')
  })

  it('falls back to a file when pagination would need too many pages', async () => {
    const jsk = makeJsk()
    const { source, send, sentMessage } = makeReactableMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.sendResult('x'.repeat(25000))

    expect(send).toHaveBeenCalledTimes(1)
    const [payload] = send.mock.calls[0] as [{ files?: unknown[] }]
    expect(payload.files).toBeDefined()
    expect(sentMessage.react).not.toHaveBeenCalled()
  })
})

describe('Context.sendCodeblock — pagination', () => {
  it('sends a single message with no reactions when it fits on one page', async () => {
    const jsk = makeJsk()
    const { source, send, sentMessage } = makeReactableMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.sendCodeblock('short output')

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentMessage.react).not.toHaveBeenCalled()
  })

  it('sends one reaction-paginated message instead of one message per page', async () => {
    const jsk = makeJsk()
    const { source, send, sentMessage } = makeReactableMessageSource()
    const ctx = new Context(jsk, source, 'js', '')

    await ctx.sendCodeblock('x'.repeat(3000))

    expect(send).toHaveBeenCalledTimes(1)
    expect(sentMessage.react).toHaveBeenCalledWith('⬅️')
    expect(sentMessage.react).toHaveBeenCalledWith('➡️')
  })
})
