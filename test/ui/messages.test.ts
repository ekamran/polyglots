import { describe, expect, it } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { errorLine, header, hintLine, nextLine, okLine, warnLine } from '../../src/ui/messages.js'
import { createPainter, plainPainter } from '../../src/ui/paint.js'

describe('message lines', () => {
  it('prefix the message with the status glyph', () => {
    expect(okLine(plainPainter, 'Synced')).toBe('✓ Synced')
    expect(errorLine(plainPainter, 'boom')).toBe('✗ boom')
    expect(warnLine(plainPainter, 'careful')).toBe('! careful')
    expect(nextLine(plainPainter, 'Open it')).toBe('› Open it')
    expect(hintLine(plainPainter, 'try this')).toBe('  try this')
  })

  it('colour only the glyph, so the message stays readable on any theme', () => {
    const line = errorLine(createPainter({ isTTY: true }, {}), 'boom')
    expect(line).toMatch(/^\x1b\[31m✗\x1b\[39m boom$/)
  })
})

describe('header', () => {
  it('names the command and subject, then aligned facts', () => {
    expect(header(plainPainter, 'translate', 'a.po', [['locale', 'tr'], ['review', 'claude']])).toEqual([
      'polyglots translate  a.po',
      '  locale  tr',
      '  review  claude',
    ])
  })

  it('stays the same text when painted', () => {
    const lines = header(createPainter({ isTTY: true }, {}), 'review', 'b.po', [['locale', 'tr']])
    expect(lines.map((l) => stripVTControlCharacters(l))).toEqual(['polyglots review  b.po', '  locale  tr'])
  })
})
