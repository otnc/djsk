/**
 * Detecting and stripping Discord codeblock markdown.
 *
 * Ported from jishaku's `jishaku.codeblocks.codeblock_converter`.
 */

/** A parsed codeblock. */
export interface Codeblock {
  /**
   * The language of the codeblock.
   *
   * An empty string when the input was a codeblock with no language,
   * or `null` when the input was not a complete codeblock at all.
   */
  language: string | null
  /** The content of the codeblock (or the raw input if it was not a codeblock). */
  content: string
}

// Direction-controlling characters Discord sometimes inserts around codeblocks.
const DIRECTION_MARKS = /[⁦-⁭]/g

/**
 * Strips codeblock markdown from `argument` if present.
 *
 * Mirrors jishaku's behaviour: triple-backtick blocks capture an optional
 * language, inline single-backtick spans are treated as language-less code,
 * and bare input is returned with `language` set to `null`.
 */
export function parseCodeblock(argument: string): Codeblock {
  const cleaned = argument.replace(DIRECTION_MARKS, '').trim()

  if (!cleaned.startsWith('`')) {
    return { language: null, content: cleaned }
  }

  // A rolling buffer of the last (up to 3) characters seen.
  const last: string[] = []
  let backticks = 0
  let inLanguage = false
  let inCode = false
  const language: string[] = []
  const code: string[] = []

  for (const char of cleaned) {
    if (char === '`' && !inCode && !inLanguage) {
      backticks += 1
    }

    const lastJoined = last.join('')
    if (
      (last.length > 0 && last[last.length - 1] === '`' && char !== '`') ||
      (inCode && lastJoined !== '`'.repeat(backticks))
    ) {
      inCode = true
      code.push(char)
    }

    if (char === '\n') {
      // Newline delimits language and code.
      inLanguage = false
      inCode = true
    } else if (lastJoined === '```' && char !== '`') {
      inLanguage = true
      language.push(char)
    } else if (inLanguage) {
      if (char !== '\n') {
        language.push(char)
      }
    }

    last.push(char)
    if (last.length > 3) last.shift()
  }

  if (code.length === 0 && language.length === 0) {
    code.push(...last)
  }

  // The raw slice keeps the newlines that delimit the language from the code
  // (e.g. "\nx\n"); strip one leading/trailing newline for a clean REPL body.
  const content = code
    .slice(language.length, code.length - backticks)
    .join('')
    .replace(/^\n/, '')
    .replace(/\n$/, '')
  return { language: language.join(''), content }
}
