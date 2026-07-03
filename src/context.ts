import { type Codeblock, parseCodeblock } from './codeblock'
import type { Jishaku } from './jishaku'
import { type MessagePayload, scrubMessagePayload } from './security'
import type { AnyClient, AnyInteraction, AnyMessage } from './types'
import { MAX_PAGINATED_PAGES, MESSAGE_LIMIT, toFile, wrapPages } from './util/format'
import { paginate } from './util/paginate'

// djsk is duck-typed at runtime: the concrete shapes differ across discord.js
// v13/v14 and the selfbot forks, so a single loose alias documents that intent
// once instead of scattering `as any` casts (and their lint suppressions).
// biome-ignore lint/suspicious/noExplicitAny: intentional cross-library duck typing.
type Loose = any

type SendPayload = MessagePayload

/** What triggered a command: a plain message, or a slash command / modal submit interaction. */
export type ContextSource =
  | { kind: 'message'; message: AnyMessage }
  | { kind: 'interaction'; interaction: AnyInteraction }

/**
 * The execution context handed to every command handler.
 *
 * Wraps either an invoking message or an interaction (slash command / modal submit) and
 * exposes cross-library send/reply/react helpers plus the parsed argument surface, so the
 * same command handlers run unchanged regardless of how they were invoked. All Discord
 * objects are duck-typed so this also works across discord.js v13/v14 and the selfbot forks.
 */
export class Context {
  constructor(
    /**
     * The owning Jishaku instance (config, client, task registry, REPL scope).
     * `Jishaku<any>`, not the bare (`AnyClient`-defaulted) `Jishaku`: `Jishaku`'s client type
     * is generic per-instance (see jishaku.ts), and `any` absorbs whichever concrete type that
     * instance was constructed with without needing a cast at every call site.
     */
    // biome-ignore lint/suspicious/noExplicitAny: absorbs Jishaku<C> for any concrete client type C.
    readonly jsk: Jishaku<any>,
    /** What triggered this command. */
    readonly source: ContextSource,
    /** The resolved subcommand name (empty string for the bare `jsk` status command). */
    readonly command: string,
    /** Everything after the subcommand name, verbatim (or the modal's code field, for js/sh). */
    readonly rawArgs: string,
  ) {}

  get client(): AnyClient {
    return this.jsk.client
  }

  /** The invoking message, or `null` when this command was triggered by an interaction. */
  get message(): AnyMessage | null {
    return this.source.kind === 'message' ? this.source.message : null
  }

  /** The triggering interaction, or `null` when this command was triggered by a message. */
  get interaction(): Loose | null {
    return this.source.kind === 'interaction' ? this.source.interaction : null
  }

  /**
   * The command prefix for display purposes (e.g. in `jsk help`).
   * `/` for interaction-triggered commands, since they're invoked as `/jsk <subcommand>`.
   */
  get prefix(): string {
    return this.source.kind === 'message' ? this.jsk.config.prefix : '/'
  }

  get author(): Loose {
    return this.source.kind === 'message'
      ? this.source.message.author
      : this.source.interaction.user
  }

  get channel(): Loose {
    return this.source.kind === 'message'
      ? (this.source.message as Loose).channel
      : this.source.interaction.channel
  }

  get guild(): Loose {
    return (
      (this.source.kind === 'message'
        ? (this.source.message as Loose).guild
        : this.source.interaction.guild) ?? null
    )
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

  /**
   * Redacts secrets from a message payload (its `content` and, in security mode, any text
   * file attachments). Every outbound method funnels through here, so this is the single
   * enforcement point for token/secret redaction.
   */
  private scrubPayload(payload: SendPayload): SendPayload {
    // Scrub text file attachments only in security mode (avoids mangling binary uploads).
    return scrubMessagePayload(payload, (text) => this.jsk.scrub(text), this.jsk.config.security)
  }

  /**
   * Guards against sending a payload Discord rejects outright (`DiscordAPIError[50006]:
   * Cannot send an empty message`) — a bare empty string, or an object with no content and no
   * files/embeds/components/stickers to carry the message instead. Substitutes a zero-width
   * space, mirroring {@link sendResult}'s existing empty-text handling.
   */
  private ensureNonEmpty(payload: SendPayload): SendPayload {
    if (typeof payload === 'string') return payload.length === 0 ? '​' : payload
    if (!payload || typeof payload !== 'object') return payload

    const hasContent = typeof payload.content === 'string' && payload.content.length > 0
    const hasOtherContent = (['files', 'embeds', 'components', 'stickers'] as const).some(
      (key) => Array.isArray(payload[key]) && payload[key].length > 0,
    )
    if (hasContent || hasOtherContent) return payload
    return { ...payload, content: '​' }
  }

  /**
   * Sends a reply through the triggering interaction, respecting its reply lifecycle
   * (`reply` once, then `editReply` if we deferred, then `followUp` for anything after).
   * Always resolves to a real message-like object (falling back to `fetchReply()`), so
   * callers can `.edit()` it exactly like a message returned from `send()`.
   */
  private async interactionSend(payload: SendPayload): Promise<AnyMessage> {
    const interaction = this.source as Extract<ContextSource, { kind: 'interaction' }>
    const raw: Loose = interaction.interaction
    let result: Loose

    if (raw.deferred && !raw.replied) {
      result = await raw.editReply(payload)
    } else if (raw.replied) {
      result = await raw.followUp(payload)
    } else {
      result = await raw.reply(payload)
    }

    if (result && typeof result.edit === 'function') return result
    return raw.fetchReply()
  }

  /** Sends a message to the invoking channel (or interaction reply/follow-up) and returns it. */
  async send(payload: SendPayload): Promise<AnyMessage> {
    const scrubbed = this.ensureNonEmpty(this.scrubPayload(payload))
    if (this.source.kind === 'interaction') return this.interactionSend(scrubbed)
    return this.channel.send(scrubbed)
  }

  /**
   * Replies to the invoking message and returns the reply. For interaction-triggered
   * commands there is no separate "message" to reply to, so this behaves like {@link send}.
   */
  async reply(payload: SendPayload): Promise<AnyMessage> {
    if (this.source.kind === 'interaction') return this.send(payload)
    return (this.source.message as Loose).reply(this.ensureNonEmpty(this.scrubPayload(payload)))
  }

  /** Edits a previously sent message, applying the same redaction as {@link send}. */
  async edit(message: AnyMessage, payload: SendPayload): Promise<AnyMessage> {
    return (message as Loose).edit(this.scrubPayload(payload))
  }

  /**
   * Adds a reaction to the invoking message (or the interaction's reply), swallowing
   * failures (e.g. missing permissions).
   */
  async react(emoji: string): Promise<void> {
    try {
      if (this.source.kind === 'interaction') {
        const interaction: Loose = this.source.interaction
        const reply = await interaction.fetchReply()
        await reply.react(emoji)
        return
      }
      await (this.source.message as Loose).react(emoji)
    } catch {
      // ignore
    }
  }

  /**
   * Sends a plain-text result, redacting the token. Content that exceeds Discord's message
   * limit is sent as a single message with ⬅️/➡️ reaction pagination (see {@link paginate})
   * instead, falling back to a file attachment only when it's too long even for that.
   * Mirrors jishaku's `jsk py` handling.
   */
  async sendResult(text: string, filename = 'output.txt'): Promise<AnyMessage> {
    const content = this.jsk.scrub(text.length === 0 ? '​' : text)
    if (content.length <= MESSAGE_LIMIT) {
      return this.send({ content, allowedMentions: { parse: [] } })
    }

    const pages = wrapPages(content, { maxSize: MESSAGE_LIMIT - 40 })
    if (pages.length > MAX_PAGINATED_PAGES) {
      return this.send({ files: [toFile(filename, content)] })
    }

    const render = (page: string, index: number, total: number) =>
      `${page}\n\n-- Page ${index + 1}/${total} --`

    const message = await this.send({
      content: render(pages[0], 0, pages.length),
      allowedMentions: { parse: [] },
    })
    await paginate(this, message, pages, render, this.author.id)
    return message
  }

  /**
   * Sends `text` wrapped in a codeblock. Content that needs more than one page is sent as a
   * single ⬅️/➡️ reaction-paginated message (see {@link paginate}) rather than one message per
   * page, and falls back to a file attachment when it would need too many pages even for that.
   */
  async sendCodeblock(text: string, language = '', filename = 'output.txt'): Promise<void> {
    const content = this.jsk.scrub(text)
    const pages = wrapPages(content, { prefix: `\`\`\`${language}`, suffix: '```', maxSize: 1940 })

    if (pages.length > MAX_PAGINATED_PAGES) {
      await this.send({ files: [toFile(filename, content)] })
      return
    }

    if (pages.length === 1) {
      await this.send({ content: pages[0], allowedMentions: { parse: [] } })
      return
    }

    const render = (page: string, index: number, total: number) =>
      `${page}\n-- Page ${index + 1}/${total} --`
    const message = await this.send({
      content: render(pages[0], 0, pages.length),
      allowedMentions: { parse: [] },
    })
    await paginate(this, message, pages, render, this.author.id)
  }
}
