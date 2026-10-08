import { describe, expect, it } from 'vitest'
import { asciiOnly, colorEnabled, createPainter, plainPainter } from '../../src/ui/paint.js'
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../../src/ui/glyphs.js'

const tty = { isTTY: true }
const pipe = { isTTY: false }

describe('colorEnabled', () => {
  it.each([
    ['a TTY with nothing set', tty, {}, true],
    ['a pipe with nothing set', pipe, {}, false],
    ['NO_COLOR on a TTY', tty, { NO_COLOR: '1' }, false],
    ['an empty NO_COLOR, which the convention says to ignore', tty, { NO_COLOR: '' }, true],
    ['NO_COLOR beating FORCE_COLOR', tty, { NO_COLOR: '1', FORCE_COLOR: '1' }, false],
    ['FORCE_COLOR on a pipe', pipe, { FORCE_COLOR: '1' }, true],
    ['FORCE_COLOR=0 on a TTY', tty, { FORCE_COLOR: '0' }, false],
    ['FORCE_COLOR=false on a TTY', tty, { FORCE_COLOR: 'false' }, false],
    ['TERM=dumb on a TTY', tty, { TERM: 'dumb' }, false],
  ])('%s', (_name, stream, env, expected) => {
    expect(colorEnabled(stream, env)).toBe(expected)
  })
})

describe('asciiOnly', () => {
  it.each([
    [{}, false],
    [{ LANG: 'en_US.UTF-8' }, false],
    [{ LANG: 'tr_TR.utf8' }, false],
    [{ LANG: 'C' }, true],
    [{ LC_ALL: 'C', LANG: 'en_US.UTF-8' }, true],
    [{ LC_ALL: 'en_US.UTF-8', LANG: 'C' }, false],
    [{ TERM: 'dumb' }, true],
    [{ POLYGLOTS_ASCII: '1', LANG: 'en_US.UTF-8' }, true],
  ])('%j → %s', (env, expected) => {
    expect(asciiOnly(env)).toBe(expected)
  })
})

describe('createPainter', () => {
  it('paints with escape codes only when colour is on', () => {
    const on = createPainter(tty, {})
    const off = createPainter(pipe, {})
    expect(on.paint('error', 'x')).toMatch(/\x1b\[/)
    expect(off.paint('error', 'x')).toBe('x')
  })

  it('sizes a piped stream to the terminal beside it, as under tee', () => {
    // review x.po | tee log: stdout is a pipe, but what it carries is still
    // read on the terminal stderr is drawn on.
    expect(createPainter(pipe, {}, { isTTY: true, columns: 60 }).width).toBe(60)
    expect(createPainter({ isTTY: true, columns: 100 }, {}, { isTTY: true, columns: 60 }).width).toBe(100)
  })

  it('falls back to COLUMNS when neither stream is a terminal', () => {
    expect(createPainter(pipe, { COLUMNS: '72' }, pipe).width).toBe(72)
    expect(createPainter(pipe, { COLUMNS: 'wide' }, pipe).width).toBe(80)
  })

  it('takes the width from the stream, and 80 when it has none', () => {
    expect(createPainter({ isTTY: true, columns: 120 }, {}).width).toBe(120)
    expect(createPainter(pipe, {}).width).toBe(80)
    expect(createPainter({ columns: 0 }, {}).width).toBe(80)
  })

  it('picks the glyph set from the environment', () => {
    expect(createPainter(tty, { LANG: 'C' }).glyphs).toBe(ASCII_GLYPHS)
    expect(createPainter(tty, {}).glyphs).toBe(UNICODE_GLYPHS)
  })

  it('has a plain painter for code that has no stream', () => {
    expect(plainPainter.color).toBe(false)
    expect(plainPainter.paint('success', 'ok')).toBe('ok')
    expect(plainPainter.glyphs).toBe(UNICODE_GLYPHS)
  })
})
