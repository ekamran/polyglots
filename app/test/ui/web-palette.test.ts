import { describe, expect, it } from 'vitest'
import { TOKENS, type Token } from '../../src/ui/tokens.js'
import { WEB_PALETTE, contrastRatio } from '../../src/ui/web-palette.js'

const TOKEN_NAMES = Object.keys(TOKENS) as Token[]

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // #767676 on white is the classic just-passing grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('WEB_PALETTE', () => {
  for (const theme of ['light', 'dark'] as const) {
    const t = WEB_PALETTE[theme]

    it(`${theme}: has a colour for every terminal token`, () => {
      expect(Object.keys(t.tokens).sort()).toEqual([...TOKEN_NAMES].sort())
    })

    // Text tokens sit on both the page and a card, so both have to pass.
    it(`${theme}: every token and the body text pass AA (4.5:1) on the page and on a panel`, () => {
      for (const bg of [t.bg, t.panel]) {
        expect(contrastRatio(t.fg, bg), `fg on ${bg}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(t.muted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5)
        for (const name of TOKEN_NAMES) {
          expect(contrastRatio(t.tokens[name], bg), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    // Chart marks are graphics, not text: WCAG 1.4.11 asks 3:1 against what
    // they sit on.
    it(`${theme}: every chart series stands out 3:1 from a panel`, () => {
      for (const colour of t.series) {
        expect(contrastRatio(colour, t.panel), colour).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${theme}: has at least eight distinct series colours`, () => {
      expect(new Set(t.series).size).toBeGreaterThanOrEqual(8)
    })
  }

  it('terminal: every token passes AA on the terminal panel', () => {
    const t = WEB_PALETTE.terminal
    expect(contrastRatio(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5)
    for (const name of TOKEN_NAMES) {
      expect(contrastRatio(t.tokens[name], t.bg), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('is plain hex strings, so a browser bundle can import it', () => {
    const all = JSON.stringify(WEB_PALETTE).match(/"#[^"]*"/g) ?? []
    expect(all.length).toBeGreaterThan(30)
    for (const v of all) expect(v).toMatch(/^"#[0-9a-f]{6}"$/)
  })
})
