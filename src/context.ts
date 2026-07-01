import { type Codeblock, parseCodeblock } from './codeblock'
import type { Jishaku } from './jishaku'
import type { AnyClient, AnyMessage } from './types'
import { MESSAGE_LIMIT, redactToken, toFile, wrapPages } from './util/format'

// djsk is duck-typed at runtime: the concrete shapes differ across discord.js
// v13/v14 and the selfbot forks, so a single loose alias documents that intent
// once instead of scattering `as any` casts (and their lint suppressions).
// biome-ignore lint/suspicious/noExplicitAny: intentional cross-library duck typing.
type Loose = any

type SendPayload = string | Record<string, Loose>

/**
 * The execution context handed to every command handler.
 *
 * Wraps the invoking message and exposes cross-library send/reply/react helpers
 * plus the parsed argument surface. All Discord objects are duck-typed so the
 * same handlers work across discord.js v13/v14 and the selfbot forks.
 */
export class Context {
  constructor(
    /** The owning Jishaku instance (config, client, task registry, REPL scope). */
    readonly jsk: Jishaku,
    /** The invoking message. */
    readonly message: AnyMessage,
    /** The resolved subcommand name (empty string for the bare `jsk` status command). */
    readonly command: string,
    /** Everything after the subcommand name, verbatim. */
    readonly rawArgs: string,
  ) {}

  get client(): AnyClient {
    return this.jsk.client
  }

  get prefix(): string {
    return this.jsk.config.prefix
  }

  get author(): Loose {
    return (this.message as Loose).author
  }

  get channel(): Loose {
    return (this.message as Loose).channel
  }

  get guild(): Loose {
    return (this.message as Loose).guild ?? null
  }

  /** Whitespace-separated argument tokens (empty when there are no args). */
  get args(): string[] {
    const trimmed = this.rawArgs.trim()
    return trimmed.length > 0 ? trimmed.split(/\s+/) : []
  }

  /** Parses `rawArgs` as a Discord codeblock, stripping markdown if present. */
  get codeblock(): Codeblock {
    return parseCodeblock(this.rawArgs)
  }

  private get token(): string | null {
    return (this.client as Loose).token ?? null
  }

  /** Sends a message to the invoking channel and returns it. */
  async send(payload: SendPayload): Promise<AnyMessage> {
    return this.channel.send(payload)
  }

  /** Replies to the invoking message and returns the reply. */
  async reply(payload: SendPayload): Promise<AnyMessage> {
    return (this.message as Loose).reply(payload)
  }

  /** Adds a reaction to the invoking message, swallowing failures (e.g. missing permissions). */
  async react(emoji: string): Promise<void> {
    try {
      await (this.message as Loose).react(emoji)
    } catch {
      // ignore
    }
  }

  /**
   * Sends a plain-text result, redacting the token. Falls back to a file attachment
   * when the content exceeds Discord's message limit. Mirrors jishaku's `jsk py` handling.
   */
  async sendResult(text: string, filename = 'output.txt'): Promise<AnyMessage> {
    const content = redactToken(text.length === 0 ? '​' : text, this.token)
    if (content.length <= MESSAGE_LIMIT) {
      return this.send({ content, allowedMentions: { parse: [] } })
    }
    return this.send({ files: [toFile(filename, content)] })
  }

  /**
   * Sends `text` wrapped in a codeblock. Splits across multiple messages when it is
   * too long, and falls back to a file attachment when it would need many pages.
   */
  async sendCodeblock(text: string, language = '', filename = 'output.txt'): Promise<void> {
    const content = redactToken(text, this.token)
    const pages = wrapPages(content, { prefix: `\`\`\`${language}`, suffix: '```', maxSize: 1980 })

    if (pages.length > 4) {
      await this.send({ files: [toFile(filename, content)] })
      return
    }
    for (const page of pages) {
      await this.send({ content: page, allowedMentions: { parse: [] } })
    }
  }
}
