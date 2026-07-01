import { resolveCommand } from './commands/registry'
import { statusCommand } from './commands/root'
import { Context } from './context'
import { OwnerResolver } from './owners'
import type { AnyClient, AnyMessage, JishakuConfig, ResolvedConfig } from './types'
import { escapeCodeblock } from './util/format'

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

function resolveConfig(config: JishakuConfig): ResolvedConfig {
  return {
    prefix: config.prefix ?? '.',
    owners: config.owners ?? null,
    encoding: config.encoding ?? 'UTF-8',
    consoleLog: config.consoleLog ?? true,
    shellTimeout: config.shellTimeout ?? 120_000,
    exitOnShutdown: config.exitOnShutdown ?? false,
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

    if (this.config.consoleLog) {
      console.info(`[djsk] Initialized. Root command: ${this.config.prefix}jsk`)
    }
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

    if (name === '') {
      await this.run(new Context(this, message, '', ''), statusCommand)
      return
    }

    const command = resolveCommand(name)
    if (!command) {
      const ctx = new Context(this, message, name, rawArgs)
      await ctx.send(`Unknown command \`${name}\`. Try \`${this.config.prefix}jsk help\`.`)
      return
    }

    await this.run(new Context(this, message, command.name, rawArgs), command.handler)
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
    if (this.config.consoleLog) console.error('[djsk] Command error:', error)
    await ctx.react('‼️')
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
    try {
      await ctx.sendCodeblock(escapeCodeblock(text), 'js', 'error.txt')
    } catch {
      // Reporting failed (e.g. missing permissions); nothing more we can do.
    }
  }
}
