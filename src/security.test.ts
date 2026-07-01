import { describe, expect, it } from 'vitest'
import { guardOutbound, SecretScrubber } from './security'

// biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
const scrubber = new SecretScrubber({ token: 'super-secret-bot-token' } as any)

describe('SecretScrubber', () => {
  it('redacts the client token', () => {
    expect(scrubber.scrub('my token is super-secret-bot-token!')).toBe('my token is [redacted]!')
  })

  it('redacts secret-like process.env values', () => {
    process.env.MY_TEST_API_SECRET = 'abcdef123456'
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    const s = new SecretScrubber({ token: 't0ken' } as any)
    expect(s.scrub('leaked value=abcdef123456 here')).toBe('leaked value=[redacted] here')
    delete process.env.MY_TEST_API_SECRET
  })

  it('redacts .env-style assignment lines', () => {
    expect(scrubber.scrub('DISCORD_TOKEN=abc.def.ghi')).toBe('DISCORD_TOKEN=[redacted]')
    expect(scrubber.scrub('export API_KEY="xyz12345"')).toBe('export API_KEY=[redacted]')
  })

  it('redacts Discord webhook URLs', () => {
    const url = 'https://discord.com/api/webhooks/123456789012345678/abcDEF-ghi_jkl'
    expect(scrubber.scrub(`hook: ${url}`)).toBe('hook: [redacted]')
  })

  it('leaves ordinary text untouched', () => {
    expect(scrubber.scrub('hello world 1 + 1 = 2')).toBe('hello world 1 + 1 = 2')
  })

  it('applies extra patterns and literal values from config', () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
    const s = new SecretScrubber({ token: 't' } as any, {
      patterns: [/\bAKIA[0-9A-Z]{16}\b/g],
      values: ['my-custom-literal'],
    })
    expect(s.scrub('key AKIAABCDEFGHIJKLMNOP and my-custom-literal')).toBe(
      'key [redacted] and [redacted]',
    )
  })
})

describe('guardOutbound', () => {
  const scrub = (text: string) => text.replaceAll('SECRET', '[redacted]')

  it('scrubs string payloads passed to response methods', async () => {
    const calls: string[] = []
    const message = {
      reply: async (payload: string) => {
        calls.push(payload)
      },
    }
    const guarded = guardOutbound(message, scrub)
    await guarded.reply('here is a SECRET')
    expect(calls).toEqual(['here is a [redacted]'])
  })

  it('scrubs the content field of object payloads', async () => {
    let received: { content?: string } | undefined
    const channel = {
      // biome-ignore lint/suspicious/noExplicitAny: test double.
      send: async (payload: any) => {
        received = payload
      },
    }
    const guarded = guardOutbound(channel, scrub)
    await guarded.send({ content: 'a SECRET value', tts: false })
    expect(received).toEqual({ content: 'a [redacted] value', tts: false })
  })

  it('guards reachable channel/author sub-objects recursively', async () => {
    const calls: string[] = []
    const message = {
      channel: {
        send: async (payload: string) => {
          calls.push(payload)
        },
      },
    }
    const guarded = guardOutbound(message, scrub)
    await guarded.channel.send('nested SECRET')
    expect(calls).toEqual(['nested [redacted]'])
  })

  it('passes non-response reads through unchanged', () => {
    const guarded = guardOutbound({ id: '123', foo: 'bar' }, scrub)
    expect(guarded.id).toBe('123')
    expect(guarded.foo).toBe('bar')
  })
})
