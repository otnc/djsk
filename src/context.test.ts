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
