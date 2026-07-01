import { arch, platform } from 'node:os'
import type { Context } from '../context'
import { naturalSize } from '../util/format'
import { DJSK_VERSION, detectLibrary } from '../util/meta'
import { COMMANDS, type Command } from './registry'

/** The bare `jsk` status summary (invoked with no subcommand). */
export async function statusCommand(ctx: Context): Promise<void> {
  const library = await detectLibrary()
  const libText = library ? `${library.name} \`${library.version}\`` : 'unknown discord.js library'

  // biome-ignore lint/suspicious/noExplicitAny: cache/ws shapes are stable across libraries.
  const client = ctx.client as any
  const guilds = client.guilds?.cache?.size ?? 0
  const users = client.users?.cache?.size ?? 0
  const wsPing = Math.round(client.ws?.ping ?? -1)

  const mem = process.memoryUsage()

  const summary: string[] = [
    `djsk v${DJSK_VERSION}, ${libText}, \`Node ${process.version}\` on \`${platform()}/${arch()}\`.`,
    `Using ${naturalSize(mem.rss)} physical memory, ${naturalSize(mem.heapUsed)} of which is heap.`,
    `This bot can see ${guilds} guild${guilds === 1 ? '' : 's'} and ${users} user${users === 1 ? '' : 's'}.`,
  ]

  const shard = client.shard
  if (shard?.ids) {
    summary.push(`This bot is sharded (shard ${shard.ids.join(', ')} of ${shard.count}).`)
  }

  summary.push(
    wsPing >= 0
      ? `Average websocket latency: ${wsPing}ms.`
      : 'Websocket latency is not available yet.',
  )

  await ctx.send({ content: summary.join('\n'), allowedMentions: { parse: [] } })
}

const helpCommand: Command = {
  name: 'help',
  summary: 'Shows this list of commands.',
  async handler(ctx) {
    const lines = [
      `**djsk** commands (prefix: \`${ctx.prefix}jsk\`)`,
      `\`${ctx.prefix}jsk\` — Status summary.`,
    ]
    for (const command of COMMANDS) {
      const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : ''
      lines.push(`\`${ctx.prefix}jsk ${command.name}\`${aliases} — ${command.summary}`)
    }
    await ctx.send({ content: lines.join('\n'), allowedMentions: { parse: [] } })
  },
}

const tasksCommand: Command = {
  name: 'tasks',
  summary: 'Lists the currently running djsk tasks.',
  async handler(ctx) {
    const tasks = ctx.jsk.tasks
    if (tasks.length === 0) {
      await ctx.send('No currently running tasks.')
      return
    }
    const lines = tasks.map(
      (task) => `${task.index}: \`${task.command}\`, invoked at ${task.invokedAt.toISOString()}`,
    )
    await ctx.sendCodeblock(lines.join('\n'))
  },
}

const cancelCommand: Command = {
  name: 'cancel',
  summary: 'Cancels a task by index (`~` for all, `-1` for the most recent).',
  async handler(ctx) {
    const tasks = ctx.jsk.tasks
    if (tasks.length === 0) {
      await ctx.send('No tasks to cancel.')
      return
    }

    const argument = ctx.args[0]

    if (argument === '~') {
      const count = tasks.length
      for (const task of [...tasks]) {
        task.cancel?.()
        ctx.jsk.removeTask(task)
      }
      await ctx.send(`Cancelled ${count} task${count === 1 ? '' : 's'}.`)
      return
    }

    const index = Number.parseInt(argument ?? '', 10)
    if (Number.isNaN(index)) {
      await ctx.send('Provide a task index, `-1` for the most recent, or `~` for all.')
      return
    }

    const task = index === -1 ? tasks[tasks.length - 1] : tasks.find((t) => t.index === index)
    if (!task) {
      await ctx.send('Unknown task.')
      return
    }

    task.cancel?.()
    ctx.jsk.removeTask(task)
    await ctx.send(`Cancelled task ${task.index}: \`${task.command}\`.`)
  },
}

export const rootCommands: Command[] = [helpCommand, tasksCommand, cancelCommand]
