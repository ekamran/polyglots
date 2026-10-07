import { describe, expect, it } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { box, displayWidth, padTo, sparkline, table, truncate } from '../../src/ui/layout.js'
import { createPainter, plainPainter } from '../../src/ui/paint.js'
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../../src/ui/glyphs.js'

const colour = createPainter({ isTTY: true }, {})

describe('displayWidth', () => {
  it.each([
    ['plain ASCII', 'akismet', 7],
    ['Turkish', 'çevrilmiş', 9],
    ['a decomposed accent', 'é', 1],
    ['CJK, two columns each', '日本語', 6],
    ['an emoji', '🙂', 2],
    ['escape codes, which take no space', colour.paint('error', 'abc'), 3],
  ])('%s', (_name, text, width) => {
    expect(displayWidth(text)).toBe(width)
  })
})

describe('padTo and truncate', () => {
  it('pads to the visible width, not the string length', () => {
    expect(stripVTControlCharacters(padTo(colour.paint('warn', '8'), 3, 'right'))).toBe('  8')
    expect(padTo('日本', 6)).toBe('日本  ')
  })

  it('truncates by columns and marks the cut', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…')
    expect(truncate('abcdefgh', 5, '...')).toBe('ab...')
    expect(truncate('日本語です', 5)).toBe('日本…')
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('table', () => {
  it('aligns columns by visible width, coloured cells included', () => {
    const rows = table([
      ['translated', '380'],
      ['fuzzy', colour.paint('warn', '8')],
    ], { align: ['left', 'right'] })
    expect(rows.map((r) => stripVTControlCharacters(r))).toEqual(['translated  380', 'fuzzy         8'])
  })

  it('indents, and leaves no trailing spaces when the last cell is empty', () => {
    expect(table([['a', 'b', '']], { indent: 2 })).toEqual(['  a  b'])
  })
})

describe('box', () => {
  it('draws a rounded frame around its lines with the title in the top edge', () => {
    expect(box(plainPainter, '✓ Done', ['translated  380'])).toEqual([
      '╭─ ✓ Done ──────────╮',
      '│  translated  380  │',
      '╰───────────────────╯',
    ])
  })

  it('keeps the right border aligned when a line holds wide characters', () => {
    const lines = box(plainPainter, 'Done', ['日本語 project', 'akismet'])
    const widths = lines.map((l) => displayWidth(l))
    expect(new Set(widths).size).toBe(1)
  })

  it('never grows past the painter width, truncating long lines', () => {
    const narrow = { ...plainPainter, width: 40 }
    const lines = box(narrow, 'Done', ['x'.repeat(100)])
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(40)
    expect(lines[1]).toContain('…')
  })

  it('draws with the ASCII set when that is what the painter carries', () => {
    const ascii = { ...plainPainter, glyphs: ASCII_GLYPHS }
    expect(box(ascii, 'Done', ['a'])[0]).toMatch(/^\+- Done -+\+$/)
  })
})

describe('sparkline', () => {
  it('scales values onto the glyph ramp, lowest to highest', () => {
    expect(sparkline([0, 7], UNICODE_GLYPHS.spark)).toBe('▁█')
    expect(sparkline([1, 1, 1], UNICODE_GLYPHS.spark)).toBe('▁▁▁')
    expect(sparkline([], UNICODE_GLYPHS.spark)).toBe('')
  })
})
