import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Context } from '../context'
import { naturalSize, toFile } from '../util/format'
import type { Command } from './registry'

const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8 MiB
const CODEBLOCK_BYTE_LIMIT = 20_000

const CAT_ARG = /^(?:\.\/+)?(.+?)(?:#L?(\d+)(?:-L?(\d+))?)?$/

// Mirrors MAX_FILE_SIZE: `curl` has no equivalent of cat's on-disk size check (there's no
// `stat()` to consult before downloading), so the cap is enforced by capping the fetch itself.
const MAX_RESPONSE_SIZE = 8 * 1024 * 1024 // 8 MiB
const FETCH_TIMEOUT_MS = 15_000

/** Thrown by {@link readTextLimited} once the response body exceeds `maxBytes`. */
class ResponseTooLargeError extends Error {}

/**
 * Reads `response`'s body as UTF-8 text, aborting once it exceeds `maxBytes`.
 *
 * Unlike `response.text()`, this doesn't trust `Content-Length` (absent or inaccurate for
 * chunked/compressed responses) — it enforces the cap against the bytes actually received,
 * streaming and cancelling as soon as the limit is crossed instead of buffering an
 * unboundedly large body into memory first.
 */
async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ResponseTooLargeError()
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf-8')
}

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

    if (lineSpan && (lineSpan[0] < 1 || lineSpan[1] < lineSpan[0])) {
      await ctx.send('Line numbers must start at 1, and the range end must not precede its start.')
      return
    }

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
      response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `Request timed out after ${FETCH_TIMEOUT_MS}ms.`
          : `Request failed: ${error instanceof Error ? error.message : String(error)}`
      await ctx.send(message)
      return
    }

    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_SIZE) {
      await ctx.send(
        `Refusing to download a response larger than ${naturalSize(MAX_RESPONSE_SIZE)} ` +
          `(reported ${naturalSize(declaredSize)}).`,
      )
      return
    }

    let data: string
    try {
      data = await readTextLimited(response, MAX_RESPONSE_SIZE)
    } catch (error) {
      if (!(error instanceof ResponseTooLargeError)) throw error
      await ctx.send(
        `Refusing to download a response larger than ${naturalSize(MAX_RESPONSE_SIZE)}.`,
      )
      return
    }

    if (!data) {
      await ctx.send(`HTTP response was empty (status code ${response.status}).`)
      return
    }

    await sendText(ctx, data, 'response.txt')
  },
}

export const filesystemCommands: Command[] = [catCommand, curlCommand]
