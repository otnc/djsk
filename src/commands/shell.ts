import type { AnyMessage } from '../types'
import { MAX_PAGINATED_PAGES, toFile, wrapPages } from '../util/format'
import { paginate } from '../util/paginate'
import { ShellReader } from '../util/shell-reader'
import type { Command } from './registry'

const EDIT_INTERVAL = 1500
const TAIL_LIMIT = 1900
// Cap on the command text echoed in the paginated view's header, so a pathologically long
// one-liner can't shrink wrapPages' per-page budget to (near-)nothing.
const MAX_HEADER_CODE_LENGTH = 200

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
      shell: ctx.jsk.config.shell,
      onLine: (line) => {
        output += `${line}\n`
        dirty = true
      },
    })

    const renderTail = (): string => {
      const tail = output.length > TAIL_LIMIT ? output.slice(output.length - TAIL_LIMIT) : output
      return `\`\`\`${reader.highlight}\n${reader.ps1} ${code}\n\n${tail}\`\`\``
    }

    const flush = async (): Promise<void> => {
      if (!dirty) return
      dirty = false
      const content = renderTail()
      try {
        if (message) {
          await ctx.edit(message, content)
        } else {
          message = await ctx.send(content)
        }
      } catch {
        // transient send/edit failure; the next flush will retry
        dirty = true
      }
    }

    // Serializes flush() calls through a single chain (never more than one send/edit request in
    // flight at once), so awaiting it always means "whatever was pending has now fully settled
    // `message`" — including a call the periodic interval already kicked off. Without this, the
    // final render below could still see `message` as `null` while an interval-triggered flush
    // is mid-`ctx.send()`, and would send a second, independent message for the same output
    // instead of reusing/editing the one already in flight.
    let flushChain: Promise<void> = Promise.resolve()
    const runFlush = (): Promise<void> => {
      flushChain = flushChain.then(flush)
      return flushChain
    }

    const task = ctx.jsk.submitTask('jsk sh', () => reader.kill())
    const interval = setInterval(() => void runFlush(), EDIT_INTERVAL)

    try {
      const exitCode = await reader.done
      output += `\n[status] Return code ${exitCode}`
      dirty = true
    } finally {
      clearInterval(interval)
      ctx.jsk.removeTask(task)
    }

    // Drain the flush chain (including anything still in flight from the interval) before
    // touching `message` below — see runFlush's doc comment. This also performs the final
    // tail-render (with the exit code appended above) for the common case.
    await runFlush()

    // Final render: like `jsk js`, output that doesn't fit in one message gets ⬅️/➡️
    // pagination over the FULL output (not just the live tail) instead of staying
    // tail-truncated, falling back to a file attachment (alongside the tail) only when it's
    // too long even for that.
    const headerCode =
      code.length > MAX_HEADER_CODE_LENGTH ? `${code.slice(0, MAX_HEADER_CODE_LENGTH)}…` : code
    const prefix = `\`\`\`${reader.highlight}\n${reader.ps1} ${headerCode}\n\n`
    const pages = wrapPages(output, { prefix, suffix: '```', maxSize: 1940 })

    if (pages.length <= 1) {
      return
    }

    if (pages.length > MAX_PAGINATED_PAGES) {
      await ctx.send({ files: [toFile('output.txt', output)] })
      return
    }

    const render = (page: string, index: number, total: number) =>
      `${page}\n-- Page ${index + 1}/${total} --`
    const lastIndex = pages.length - 1
    const finalContent = render(pages[lastIndex], lastIndex, pages.length)

    try {
      message = message ? await ctx.edit(message, finalContent) : await ctx.send(finalContent)
    } catch {
      return
    }

    await paginate(ctx, message, pages, render, ctx.author.id, lastIndex)
  },
}

export const shellCommands: Command[] = [shellCommand]
