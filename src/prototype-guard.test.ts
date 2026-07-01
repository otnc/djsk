import { describe, expect, it } from 'vitest'
import { installPrototypeGuards } from './prototype-guard'

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
