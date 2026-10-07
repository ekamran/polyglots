import { describe, expect, it } from 'vitest'
import { displayWidth } from '../../src/ui/layout.js'
import { WORDMARK, WORDMARK_PLAIN, wordmarkWidth } from '../../src/ui/wordmark.js'

describe('wordmark', () => {
  it('is four lines of block glyphs, as wide as its widest line', () => {
    expect(WORDMARK).toHaveLength(4)
    expect(wordmarkWidth).toBe(18)
    expect(Math.max(...WORDMARK.map(displayWidth))).toBe(wordmarkWidth)
  })

  // The issue's art, character for character: the website renders this same
  // export, so a stray edit here shows up on two surfaces at once.
  it('spells polyglots in quadrant blocks', () => {
    expect(WORDMARK[1]).toBe('▛▌▛▌▐ ▌▌▛▌▐ ▛▌▜▘▛▘')
    expect(WORDMARK_PLAIN).toBe('polyglots')
  })
})
