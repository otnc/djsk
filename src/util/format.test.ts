import { describe, expect, it } from 'vitest'
import { inspectResult, naturalSize, redactToken, wrapPages } from './format'

describe('inspectResult', () => {
  it('returns strings unchanged', () => {
    expect(inspectResult('hello')).toBe('hello')
  })

  it('inspects non-string values', () => {
    expect(inspectResult({ a: 1 })).toContain('a: 1')
    expect(inspectResult(42)).toBe('42')
  })
})

describe('redactToken', () => {
  it('replaces every occurrence of the token', () => {
    expect(redactToken('a SECRET b SECRET', 'SECRET')).toBe('a [token omitted] b [token omitted]')
  })

  it('is a no-op when the token is falsy', () => {
    expect(redactToken('unchanged', null)).toBe('unchanged')
    expect(redactToken('unchanged', '')).toBe('unchanged')
  })
})

describe('naturalSize', () => {
  it('formats bytes', () => {
    expect(naturalSize(512)).toBe('512 B')
  })

  it('formats kibibytes and mebibytes', () => {
    expect(naturalSize(1536)).toBe('1.50 KiB')
    expect(naturalSize(5 * 1024 * 1024)).toBe('5.00 MiB')
  })
})

describe('wrapPages', () => {
  it('wraps short content in a single page with prefix/suffix', () => {
    expect(wrapPages('hi', { prefix: '```js', suffix: '```' })).toEqual(['```js\nhi\n```'])
  })

  it('splits content that exceeds the page budget across multiple pages', () => {
    const line = 'x'.repeat(50)
    const text = Array.from({ length: 10 }, () => line).join('\n')
    const pages = wrapPages(text, { prefix: '```', suffix: '```', maxSize: 120 })
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(120)
      expect(page.startsWith('```')).toBe(true)
      expect(page.endsWith('```')).toBe(true)
    }
  })

  it('hard-splits a single line longer than the budget', () => {
    const pages = wrapPages('y'.repeat(300), { maxSize: 100 })
    expect(pages.length).toBeGreaterThan(1)
  })
})
