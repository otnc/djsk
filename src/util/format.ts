import { inspect } from 'node:util'

/** Discord's hard limit for a single message's content. */
export const MESSAGE_LIMIT = 2000

/**
 * Above this many pages, output is sent as a file attachment instead of a reaction-paginated
 * message — keeps pagination usable (and the arrow reactions meaningful) instead of turning
 * into a many-dozens-of-pages click-through for genuinely huge output.
 */
export const MAX_PAGINATED_PAGES = 10

/** Zero-width space used to defuse backtick sequences inside codeblocks. */
const ZWSP = '​'

/**
 * Represents a raw file attachment payload accepted by both discord.js v13 and v14
 * (`{ attachment, name }`), avoiding version-specific builder classes.
 */
export interface RawFile {
  attachment: Buffer
  name: string
}

/** Formats an arbitrary REPL result into a display string, mirroring jishaku's repr handling. */
export function inspectResult(value: unknown): string {
  if (typeof value === 'string') return value
  return inspect(value, { depth: 2, maxArrayLength: 100, breakLength: 100 })
}

/** Replaces every occurrence of the bot token with a placeholder. */
export function redactToken(text: string, token: string | null | undefined): string {
  if (!token) return text
  return text.split(token).join('[token omitted]')
}

/** Escapes triple-backticks so a string can be safely embedded inside a codeblock. */
export function escapeCodeblock(text: string): string {
  return text.replaceAll('```', `\`\`${ZWSP}\``)
}

/** Humanizes a byte count (e.g. `1536` -> `1.5 KiB`). Ported from jishaku's `natural_size`. */
export function naturalSize(size: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB']
  let value = size
  let unit = units[0]
  for (const candidate of units) {
    unit = candidate
    if (Math.abs(value) < 1024) break
    value /= 1024
  }
  const rounded = unit === 'B' ? String(value) : value.toFixed(2)
  return `${rounded} ${unit}`
}

interface WrapOptions {
  /** Text placed at the start of every page (e.g. ```` ```js ````). Default: empty. */
  prefix?: string
  /** Text placed at the end of every page (e.g. ```` ``` ````). Default: empty. */
  suffix?: string
  /** Maximum size of a single page including prefix/suffix. Default: 1980. */
  maxSize?: number
}

/**
 * Splits `text` into pages that each fit within `maxSize`, wrapping every page in
 * `prefix`/`suffix`. Splits on line boundaries where possible and hard-splits lines
 * that are individually too long. Loosely ports jishaku's `WrappedPaginator`.
 */
export function wrapPages(text: string, options: WrapOptions = {}): string[] {
  const prefix = options.prefix ?? ''
  const suffix = options.suffix ?? ''
  const maxSize = options.maxSize ?? 1980
  // Clamped to at least 1: a prefix/suffix that (nearly) fills maxSize on its own would
  // otherwise drive this to zero or negative, and the hard-split loop below never
  // terminates without positive forward progress.
  const budget = Math.max(1, maxSize - prefix.length - suffix.length - 2) // 2 newlines around content

  const chunks: string[] = []
  for (const rawLine of text.split('\n')) {
    if (rawLine.length <= budget) {
      chunks.push(rawLine)
      continue
    }
    // Hard-split overly long lines.
    for (let i = 0; i < rawLine.length; i += budget) {
      chunks.push(rawLine.slice(i, i + budget))
    }
  }

  const pages: string[] = []
  let current: string[] = []
  let currentLength = 0

  const flush = () => {
    if (current.length === 0) return
    pages.push(`${prefix}${prefix ? '\n' : ''}${current.join('\n')}${suffix ? '\n' : ''}${suffix}`)
    current = []
    currentLength = 0
  }

  for (const chunk of chunks) {
    const added = chunk.length + 1 // + newline
    if (currentLength + added > budget && current.length > 0) flush()
    current.push(chunk)
    currentLength += added
  }
  flush()

  return pages.length > 0 ? pages : [`${prefix}${suffix}`]
}

/** Builds a raw file attachment from string content. */
export function toFile(name: string, content: string): RawFile {
  return { attachment: Buffer.from(content, 'utf-8'), name }
}
