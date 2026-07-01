import type { AnyMessage } from '../types'
import { ShellReader } from '../util/shell-reader'
import type { Command } from './registry'

const EDIT_INTERVAL = 1500
const TAIL_LIMIT = 1900

const shellCommand: Command = {
  name: 'sh',
  aliases: ['shell', 'bash', 'cmd', 'powershell', 'terminal'],
  summary: 'Executes a command in the system shell, streaming its output.',
  async handler(ctx) {
    const code = ctx.codeblock.content
    if (!code.trim()) {
      await ctx.send('No command to run.')
      return
    }

    let output = ''
    let dirty = true
    let message: AnyMessage | null = null

    const reader = new ShellReader(code, {
      encoding: ctx.jsk.config.encoding,
      timeout: ctx.jsk.config.shellTimeout,
      onLine: (line) => {
        output += `${line}\n`
        dirty = true
      },
    })

    const render = (): string => {
      const tail = output.length > TAIL_LIMIT ? output.slice(output.length - TAIL_LIMIT) : output
      return `\`\`\`${reader.highlight}\n${reader.ps1} ${code}\n\n${tail}\`\`\``
    }

    const flush = async (): Promise<void> => {
      if (!dirty) return
      dirty = false
      const content = render()
      try {
        if (message) {
          // biome-ignore lint/suspicious/noExplicitAny: edit exists on all supported Message types.
          await (message as any).edit(content)
        } else {
          message = await ctx.send(content)
        }
      } catch {
        // transient send/edit failure; the next flush will retry
        dirty = true
      }
    }

    const task = ctx.jsk.submitTask('jsk sh', () => reader.kill())
    const interval = setInterval(() => void flush(), EDIT_INTERVAL)

    try {
      const exitCode = await reader.done
      output += `\n[status] Return code ${exitCode}`
      dirty = true
    } finally {
      clearInterval(interval)
      ctx.jsk.removeTask(task)
    }

    await flush()
  },
}

export const shellCommands: Command[] = [shellCommand]
