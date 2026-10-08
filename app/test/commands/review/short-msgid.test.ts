import { describe, expect, it } from 'vitest'
import { shortMsgid } from '../../../src/commands/review.js'

// The run screens show each entry's msgid on one line, capped. Cutting by
// UTF-16 code unit could split an emoji's surrogate pair, which draws as a
// replacement character, or a family emoji's joined sequence.
describe('shortMsgid', () => {
  it('never splits a character made of a surrogate pair', () => {
    const text = `${'a'.repeat(78)}😀 and more after it`
    const short = shortMsgid(text)
    expect(short.endsWith('…')).toBe(true)
    expect(short).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('never splits a joined emoji sequence', () => {
    const family = '👨‍👩‍👧'
    const text = `${'a'.repeat(77)}${family} and more after it`
    const short = shortMsgid(text)
    expect(short.includes(family) || !short.includes('👨')).toBe(true)
  })

  it('leaves a short msgid as it is, on one line', () => {
    expect(shortMsgid('Hello\n  world')).toBe('Hello world')
  })
})
