import { describe, expect, it } from 'vitest'
import { installPrototypeGuards, installRestGuard } from './prototype-guard'

const scrub = (text: string) => text.replaceAll('SECRET', '[redacted]')

describe('installPrototypeGuards', () => {
  it('scrubs send/reply payloads on the library classes and restores them afterwards', async () => {
    class TextChannel {
      calls: unknown[] = []
      async send(payload: unknown) {
        this.calls.push(payload)
        return payload
      }
    }
    class Message {
      calls: unknown[] = []
      async reply(payload: unknown) {
        this.calls.push(payload)
        return payload
      }
    }

    const originalSend = TextChannel.prototype.send
    const originalReply = Message.prototype.reply

    const restore = installPrototypeGuards({ TextChannel, Message }, scrub)

    const channel = new TextChannel()
    await channel.send('leak SECRET here')
    expect(channel.calls).toEqual(['leak [redacted] here'])

    const message = new Message()
    await message.reply({ content: 'a SECRET value' })
    expect(message.calls).toEqual([{ content: 'a [redacted] value' }])

    restore()

    expect(TextChannel.prototype.send).toBe(originalSend)
    expect(Message.prototype.reply).toBe(originalReply)
  })

  it('does not patch Manager classes or the deny-listed gateway/IPC classes', () => {
    class UserManager {
      async send(payload: unknown) {
        return payload
      }
    }
    class Shard {
      async send(payload: unknown) {
        return payload
      }
    }

    const originalManagerSend = UserManager.prototype.send
    const originalShardSend = Shard.prototype.send

    const restore = installPrototypeGuards({ UserManager, Shard }, scrub)

    expect(UserManager.prototype.send).toBe(originalManagerSend)
    expect(Shard.prototype.send).toBe(originalShardSend)

    restore()
  })

  it('reaches methods inherited from a base class exported alongside a subclass', async () => {
    class BaseGuildTextChannel {
      calls: unknown[] = []
      async send(payload: unknown) {
        this.calls.push(payload)
        return payload
      }
    }
    class TextChannel extends BaseGuildTextChannel {}

    const restore = installPrototypeGuards({ BaseGuildTextChannel, TextChannel }, scrub)

    const channel = new TextChannel()
    await channel.send('a SECRET')
    expect(channel.calls).toEqual(['a [redacted]'])

    restore()
  })
})

describe('installRestGuard', () => {
  it("scrubs body.content on a REST class's request() and restores it afterwards", async () => {
    class REST {
      calls: unknown[] = []
      async request(options: unknown) {
        this.calls.push(options)
        return options
      }
    }
    const originalRequest = REST.prototype.request

    const restore = installRestGuard({ REST }, scrub)
    expect(restore).not.toBeNull()

    const rest = new REST()
    await rest.request({
      method: 'POST',
      fullRoute: '/channels/1/messages',
      body: { content: 'a SECRET value' },
    })
    expect(rest.calls).toEqual([
      {
        method: 'POST',
        fullRoute: '/channels/1/messages',
        body: { content: 'a [redacted] value' },
      },
    ])

    restore?.()
    expect(REST.prototype.request).toBe(originalRequest)
  })

  it('leaves requests with no body (e.g. GET) untouched', async () => {
    class REST {
      calls: unknown[] = []
      async request(options: unknown) {
        this.calls.push(options)
        return options
      }
    }

    const restore = installRestGuard({ REST }, scrub)
    const rest = new REST()
    await rest.request({ method: 'GET', fullRoute: '/users/@me' })
    expect(rest.calls).toEqual([{ method: 'GET', fullRoute: '/users/@me' }])

    restore?.()
  })

  it('returns null when the module has no REST export (v13 and the selfbot forks)', () => {
    class TextChannel {}
    expect(installRestGuard({ TextChannel }, scrub)).toBeNull()
  })

  it('does not double-guard when called twice for the same class (nested/concurrent evals)', async () => {
    class REST {
      calls: unknown[] = []
      async request(options: unknown) {
        this.calls.push(options)
        return options
      }
    }

    const restoreOuter = installRestGuard({ REST }, scrub)
    const restoreInner = installRestGuard({ REST }, scrub)
    expect(restoreInner).toBeNull()

    const rest = new REST()
    await rest.request({ body: { content: 'a SECRET' } })
    // Scrubbed exactly once, not twice (which would be harmless here but signals double-wrapping).
    expect(rest.calls).toEqual([{ body: { content: 'a [redacted]' } }])

    restoreOuter?.()
  })
})
