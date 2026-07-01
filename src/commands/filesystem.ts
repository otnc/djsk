import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Context } from '../context'
import { toFile } from '../util/format'
import type { Command } from './registry'

const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8 MiB
const CODEBLOCK_BYTE_LIMIT = 20_000

const CAT_ARG = /^(?:\.\/+)?(.+?)(?:#L?(\d+)(?:-L?(\d+))?)?$/

/** Sends text as a plain codeblock, falling back to a file attachment when it is large. */
async function sendText(ctx: Context, content: string, filename: string): Promise<void> {
  const scrubbed = ctx.jsk.scrub(content)
  if (Buffer.byteLength(scrubbed, 'utf-8') > CODEBLOCK_BYTE_LIMIT) {
    await ctx.send({ files: [toFile(filename, scrubbed)] })
    return
  }
  await ctx.sendCodeblock(scrubbed, '', filename)
}

const catCommand: Command = {
  name: 'cat',
  summary: 'Reads a file. Supports line spans, e.g. `path/to/file#L10-20`.',
  async handler(ctx) {
    const argument = ctx.args[0]
    if (!argument) {
      await ctx.send('Provide a file path.')
      return
    }

    const match = CAT_ARG.exec(argument)
    if (!match) {
      await ctx.send("Couldn't parse this input.")
      return
    }

    const path = match[1]
    const lineSpan = match[2]
      ? ([Number.parseInt(match[2], 10), Number.parseInt(match[3] ?? match[2], 10)] as const)
      : null

    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(path)
    } catch {
      await ctx.send(`\`${path}\`: No file by that name.`)
      return
    }

    if (info.isDirectory()) {
      await ctx.send(`\`${path}\`: That is a directory.`)
      return
    }
    if (info.size <= 0) {
      await ctx.send(
        `\`${path}\`: Refusing to read a file with no size (it may be empty or inaccessible).`,
      )
      return
    }
    if (info.size > MAX_FILE_SIZE) {
      await ctx.send(`\`${path}\`: Refusing to read a file larger than 8 MiB.`)
      return
    }

    let content = await readFile(path, 'utf-8')
    if (lineSpan) {
      content = content
        .split('\n')
        .slice(lineSpan[0] - 1, lineSpan[1])
        .join('\n')
    }

    await sendText(ctx, content, basename(path))
  },
}

const curlCommand: Command = {
  name: 'curl',
  summary: 'Downloads and displays a text resource from a URL.',
  async handler(ctx) {
    const argument = ctx.args[0]
    if (!argument) {
      await ctx.send('Provide a URL.')
      return
    }

    const url = argument.replace(/^</, '').replace(/>$/, '')

    let response: Response
    try {
      response = await fetch(url)
    } catch (error) {
      await ctx.send(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const data = await response.text()
    if (!data) {
      await ctx.send(`HTTP response was empty (status code ${response.status}).`)
      return
    }

    await sendText(ctx, data, 'response.txt')
  },
}

export const filesystemCommands: Command[] = [catCommand, curlCommand]
