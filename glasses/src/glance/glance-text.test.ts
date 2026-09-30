import { describe, expect, it } from 'vitest'
import { paginateGlassesText, toGlassesLabel, toGlassesText } from './glance-text'

describe('toGlassesText', () => {
  it('drops ANSI styling, OSC titles and control bytes the firmware cannot draw', () => {
    expect(toGlassesText('\u001b[1;32mok\u001b[0m\u001b]0;title\u0007 done\u0007\r\n')).toBe(
      'ok done'
    )
  })

  it('keeps paragraph breaks but collapses runs of blank lines', () => {
    expect(toGlassesText('a\n\n\n\nb\tc')).toBe('a\n\nb  c')
  })
})

describe('toGlassesLabel', () => {
  it('stays within the list item limit with an ASCII ellipsis', () => {
    const label = toGlassesLabel(`first line\nsecond ${'x'.repeat(80)}`)
    expect(label).toHaveLength(64)
    expect(label.startsWith('first line second')).toBe(true)
    expect(label.endsWith('...')).toBe(true)
  })
})

describe('paginateGlassesText', () => {
  it('breaks on word boundaries and never exceeds the page size', () => {
    const words = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ')
    const pages = paginateGlassesText(words, 100)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.length <= 100)).toBe(true)
    expect(pages.join(' ')).toBe(words)
  })

  it('prefers a paragraph break inside the window', () => {
    const pages = paginateGlassesText(`${'a '.repeat(30)}\n\n${'b '.repeat(30)}`, 80)
    expect(pages[0]?.endsWith('a')).toBe(true)
    expect(pages[1]?.startsWith('b')).toBe(true)
  })

  it('hard-cuts a single oversized token', () => {
    expect(paginateGlassesText('x'.repeat(250), 100)).toEqual([
      'x'.repeat(100),
      'x'.repeat(100),
      'x'.repeat(50)
    ])
  })

  it('returns one empty page for empty text', () => {
    expect(paginateGlassesText('   ')).toEqual([''])
  })
})
