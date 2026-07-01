import { resolveCommand } from './commands/registry'
import { statusCommand } from './commands/root'
import { Context } from './context'
import { OwnerResolver } from './owners'
import { SecretScrubber } from './security'
import { buildCodeModal, CODE_FIELD_ID, CODE_SUBCOMMANDS, subcommandFromModalId } from './slash'
import type { AnyClient, AnyInteraction, AnyMessage, JishakuConfig, ResolvedConfig } from './types'
import { escapeCodeblock, redactToken } from './util/format'

/** A tracked, potentially long-running djsk command invocation. */
export interface CommandTask {
  /** Monotonic index used to reference the task in `jsk tasks` / `jsk cancel`. */
  index: number
  /** The resolved command name. */
  command: string
  /** When the task was submitted. */
  invokedAt: Date
  /** Cancellation hook (kills the shell process, aborts the loop, ...). */
  cancel?: () => void
}

const ROOT_NAMES = ['jsk', 'jishaku']

/** Splits the post-root text into the subcommand name and the verbatim remainder. */
function splitCommand(rest: string): { name: string; rawArgs: string } {
  const match = rest.match(/^(\S+)\s*([\s\S]*)$/)
  if (!match) return { name: '', rawArgs: '' }
  return { name: match[1], rawArgs: match[2] }
}

/**
 * Translates a slash command's structured options back into the single `rawArgs` string
 * command handlers expect, as if the equivalent text had been typed after the subcommand name.
 */
// biome-ignore lint/suspicious/noExplicitAny: interaction option resolvers are duck-typed across libraries.
function extractOptionArgs(raw: any, subcommand: string): string {
  switch (subcommand) {
    case 'cat':
      return raw.options.getString('path') ?? ''
    case 'curl':
      return raw.options.getString('url') ?? ''
    case 'cancel':
      return raw.options.getString('index') ?? ''
    case 'retain':
      return raw.options.getString('toggle') ?? ''
    default:
      return ''
  }
}

function resolveConfig(config: JishakuConfig): ResolvedConfig {
  return {
    prefix: config.prefix ?? '.',
    owners: config.owners ?? null,
    encoding: config.encoding ?? 'UTF-8',
    consoleLog: config.consoleLog ?? true,
    slashCommandName: config.slashCommandName ?? 'jsk',
    shellTimeout: config.shellTimeout ?? 120_000,
    exitOnShutdown: config.exitOnShutdown ?? false,
    security: config.security ?? false,
    secretPatterns: config.secretPatterns ?? [],
    secretValues: config.secretValues ?? [],
  }
}

/**
 * The djsk frontend: the Discord.js port of jishaku.
 *
 * Wire it up with manual dispatch (djsk-v13 compatible):
 *
 * ```ts
 * const jsk = new Jishaku(client, { owners: ['1234567890'] })
 * client.on('messageCreate', (m) => jsk.onMessageCreated(m))
 * ```
 */
export class Jishaku {
  readonly config: ResolvedConfig
  readonly owners: OwnerResolver
  private readonly scrubber: SecretScrubber

  /** Whether REPL variable retention is enabled (`jsk retain`). */
  retain = false
  /** Persistent bag of user variables for the REPL when retention is on. */
  replVars: Record<string, unknown> = {}
  /** The last REPL result, exposed as `_` inside `jsk js`. */
  lastResult: unknown = null

  private readonly taskList: CommandTask[] = []
  private taskCounter = 0

  constructor(
    readonly client: AnyClient,
    config: JishakuConfig = {},
  ) {
    this.config = resolveConfig(config)
    this.owners = new OwnerResolver(client, this.config.owners)
    this.scrubber = new SecretScrubber(client, {
      patterns: this.config.secretPatterns,
      values: this.config.secretValues,
    })

    if (this.config.consoleLog) {
      const security = this.config.security ? ' (security mode ON)' : ''
      console.info(`[djsk] Initialized. Root command: ${this.config.prefix}jsk${security}`)
    }
  }

  /**
   * Redacts secrets from `text` before it is exposed anywhere.
   *
   * The Discord token is always redacted; when security mode is enabled, secret-like
   * environment values, `.env` assignments and common credential formats are redacted too.
   * All djsk output and logging funnels through this method.
   */
  scrub(text: string): string {
    // biome-ignore lint/suspicious/noExplicitAny: token location is stable across libraries.
    const out = redactToken(text, (this.client as any)?.token)
    return this.config.security ? this.scrubber.scrub(out) : out
  }

  /** Currently tracked tasks, oldest first. */
  get tasks(): readonly CommandTask[] {
    return this.taskList
  }

  /** Registers a task and returns it. Call {@link removeTask} when it finishes. */
  submitTask(command: string, cancel?: () => void): CommandTask {
    this.taskCounter += 1
    const task: CommandTask = {
      index: this.taskCounter,
      command,
      invokedAt: new Date(),
      cancel,
    }
    this.taskList.push(task)
    return task
  }

  /** Removes a previously submitted task. */
  removeTask(task: CommandTask): void {
    const index = this.taskList.indexOf(task)
    if (index !== -1) this.taskList.splice(index, 1)
  }

  /**
   * Message handler. Pass every `messageCreate` message here.
   *
   * Ignores messages that don't target the djsk root command or whose author
   * is not an owner. Never throws — command errors are reported to the channel.
   */
  async onMessageCreated(message: AnyMessage): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: content/author are duck-typed across libraries.
    const raw = message as any
    const content: unknown = raw?.content
    if (typeof content !== 'string') return

    const rest = this.matchRoot(content)
    if (rest === null) return

    const authorId = raw.author?.id
    if (!authorId) return
    if (!(await this.owners.isOwner(String(authorId)))) return

    const { name, rawArgs } = splitCommand(rest)
    const source = { kind: 'message' as const, message }

    if (name === '') {
      await this.run(new Context(this, source, '', ''), statusCommand)
      return
    }

    const command = resolveCommand(name)
    if (!command) {
      const ctx = new Context(this, source, name, rawArgs)
      await ctx.send(`Unknown command \`${name}\`. Try \`${this.config.prefix}jsk help\`.`)
      return
    }

    await this.run(new Context(this, source, command.name, rawArgs), command.handler)
  }

  /**
   * Interaction handler. Pass every `interactionCreate` event here.
   *
   * Handles the `/jsk` (or configured `slashCommandName`) slash command and its subcommands,
   * plus the code-input modals that `js`/`sh` show instead of taking a string option. Ignores
   * anything else. Never throws — command errors are reported back through the interaction.
   */
  async onInteractionCreate(interaction: AnyInteraction): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: interaction shapes are duck-typed across libraries.
    const raw = interaction as any

    const isModalSubmit =
      typeof raw.isModalSubmit === 'function' ? raw.isModalSubmit() : raw.type === 5
    if (isModalSubmit) {
      await this.handleModalSubmit(raw)
      return
    }

    const isChatInput =
      typeof raw.isChatInputCommand === 'function'
        ? raw.isChatInputCommand()
        : typeof raw.isCommand === 'function'
          ? raw.isCommand()
          : raw.type === 2
    if (!isChatInput || raw.commandName !== this.config.slashCommandName) return

    const userId = raw.user?.id
    if (!userId) return
    if (!(await this.owners.isOwner(String(userId)))) {
      try {
        await raw.reply({ content: 'You are not allowed to use this command.', ephemeral: true })
      } catch {
        // ignore
      }
      return
    }

    const subcommand: string = raw.options.getSubcommand()

    if (CODE_SUBCOMMANDS.has(subcommand)) {
      await raw.showModal(buildCodeModal(subcommand as 'js' | 'sh'))
      return
    }

    const source = { kind: 'interaction' as const, interaction: raw }
    const rawArgs = extractOptionArgs(raw, subcommand)

    if (subcommand === 'status') {
      await this.deferAndRun(new Context(this, source, '', rawArgs), statusCommand)
      return
    }

    const command = resolveCommand(subcommand)
    if (!command) return // Shouldn't happen: Discord only sends subcommands we registered.

    await this.deferAndRun(new Context(this, source, command.name, rawArgs), command.handler)
  }

  /** Handles the submission of a `js`/`sh` code-input modal shown by {@link onInteractionCreate}. */
  private async handleModalSubmit(raw: AnyInteraction): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: interaction shapes are duck-typed across libraries.
    const modal = raw as any
    const subcommand = subcommandFromModalId(modal.customId ?? '')
    if (!subcommand) return

    const userId = modal.user?.id
    if (!userId) return
    if (!(await this.owners.isOwner(String(userId)))) return

    const command = resolveCommand(subcommand)
    if (!command) return

    const code: string = modal.fields.getTextInputValue(CODE_FIELD_ID)
    const source = { kind: 'interaction' as const, interaction: modal }
    await this.deferAndRun(new Context(this, source, command.name, code), command.handler)
  }

  /** Defers the interaction's reply, then runs `handler`, matching message-based error handling. */
  private async deferAndRun(
    ctx: Context,
    handler: (ctx: Context) => Promise<void> | void,
  ): Promise<void> {
    try {
      await ctx.interaction?.deferReply()
    } catch {
      // Already acknowledged (e.g. by a fast handler racing us); proceed regardless.
    }
    await this.run(ctx, handler)
  }

  /** Returns the text after the root command, or `null` if the message isn't a djsk invocation. */
  private matchRoot(content: string): string | null {
    for (const root of ROOT_NAMES) {
      const full = this.config.prefix + root
      if (content === full) return ''
      if (content.startsWith(`${full} `) || content.startsWith(`${full}\n`)) {
        return content.slice(full.length).replace(/^\s+/, '')
      }
    }
    return null
  }

  private async run(ctx: Context, handler: (ctx: Context) => Promise<void> | void): Promise<void> {
    try {
      await handler(ctx)
    } catch (error) {
      await this.reportError(ctx, error)
    }
  }

  private async reportError(ctx: Context, error: unknown): Promise<void> {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
    if (this.config.consoleLog) console.error('[djsk] Command error:', this.scrub(text))
    await ctx.react('‼️')
    try {
      await ctx.sendCodeblock(escapeCodeblock(text), 'js', 'error.txt')
    } catch {
      // Reporting failed (e.g. missing permissions); nothing more we can do.
    }
  }
}
