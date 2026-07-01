import { describe, expect, it } from 'vitest'
import { parseCodeblock } from './codeblock'

describe('parseCodeblock', () => {
  it('returns raw input with null language when there is no codeblock', () => {
    expect(parseCodeblock('1 + 1')).toEqual({ language: null, content: '1 + 1' })
  })

  it('trims surrounding whitespace on bare input', () => {
    expect(parseCodeblock('  hello world  ')).toEqual({ language: null, content: 'hello world' })
  })

  it('parses a triple-backtick block with a language', () => {
    expect(parseCodeblock('```js\nconsole.log(1)\n```')).toEqual({
      language: 'js',
      content: 'console.log(1)',
    })
  })

  it('parses a triple-backtick block without a language', () => {
    expect(parseCodeblock('```\nplain\n```')).toEqual({ language: '', content: 'plain' })
  })

  it('parses an inline single-backtick span as language-less code', () => {
    const result = parseCodeblock('`inline`')
    expect(result.content).toBe('inline')
  })

  it('preserves multi-line content inside a block', () => {
    expect(parseCodeblock('```py\na = 1\nb = 2\n```')).toEqual({
      language: 'py',
      content: 'a = 1\nb = 2',
    })
  })

  it('strips direction-control characters', () => {
    expect(parseCodeblock('⁦```js\nx\n```⁩')).toEqual({ language: 'js', content: 'x' })
  })
})
