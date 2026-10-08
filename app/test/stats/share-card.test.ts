import { describe, expect, it } from 'vitest'
import { demoPayloads } from '../../src/stats/demo.js'
import { ENGLISH } from '../../src/stats/i18n.js'
import { SHARE_HEIGHT, SHARE_WIDTH, shareCard } from '../../src/stats/page/share-card.js'
import { STATS_TRANSLATIONS } from '../../src/stats/translations-data.js'

const demo = demoPayloads()
const TR = STATS_TRANSLATIONS.find((l) => l.tag === 'tr')!

describe('shareCard', () => {
  it('is a standalone SVG the size social cards use', () => {
    const svg = shareCard(demo.all, ENGLISH)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}"`)
    expect([SHARE_WIDTH, SHARE_HEIGHT]).toEqual([1200, 630])
  })

  it('carries the totals and the top projects', () => {
    const svg = shareCard(demo.all, ENGLISH)
    expect(svg).toContain(demo.all.review.entries.toLocaleString('en'))
    expect(svg).toContain(demo.all.review.submissions.toLocaleString('en'))
    const top = [...demo.all.review.byProject].sort((a, b) => b.entries - a.entries)[0]!
    expect(svg).toContain(top.project.replace(/&/g, '&amp;'))
  })

  // A rasterised SVG may not reach outside itself (the canvas would be
  // tainted and the PNG would never download), and Safari taints on
  // foreignObject alone.
  it('loads nothing from outside and uses no foreignObject', () => {
    const svg = shareCard(demo.all, ENGLISH)
    expect(svg).not.toMatch(/href=|url\(|@import|foreignObject/)
  })

  // In the bottom right, opposite the tagline, as text: an href would taint
  // the canvas the PNG is drawn through.
  it('names the site in the bottom right corner', () => {
    const svg = shareCard(demo.all, ENGLISH)
    expect(svg).toMatch(/<text x="1136" y="584" font-size="18" text-anchor="end"[^>]*>https:\/\/ada\.tools\/polyglots\/<\/text>/)
  })

  it('escapes project names', () => {
    const p = structuredClone(demo['30d'])
    p.review.byProject = [{ project: 'A <b> & "C"', runs: 1, entries: 9, flagged: 1 }]
    expect(shareCard(p, ENGLISH)).toContain('A &lt;b&gt; &amp; &quot;C&quot;')
  })

  it('shortens a long project name rather than running off the card', () => {
    const p = structuredClone(demo['30d'])
    p.review.byProject = [{ project: 'An Extremely Long Plugin Name That Goes On And On Forever', runs: 1, entries: 9, flagged: 1 }]
    expect(shareCard(p, ENGLISH)).toContain('…')
  })

  it('follows the page language', () => {
    expect(shareCard(demo.all, TR)).toContain(demo.all.review.entries.toLocaleString('tr'))
    expect(shareCard(demo.all, TR)).toContain('polyglots ile')
  })
})
