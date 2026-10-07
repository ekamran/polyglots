import { describe, expect, it } from 'vitest'
import { demoPayloads } from '../../src/stats/demo.js'
import { renderStaticPage, renderStats } from '../../src/stats/render.js'
import type { ReviewStats, TranslateStats } from '../../src/stats/query.js'

const HOUR = 3_600_000
const flat = (html: string) => html.replace(/\s+/g, ' ')
// The visible markup, without the embedded data and script, which carry raw
// JSON and the client's own string literals.
const markup = (html: string) => html.slice(0, html.indexOf('<script'))

const empty: ReviewStats = {
  submissions: 0,
  entries: 0,
  flagged: 0,
  repaired: 0,
  approvable: 0,
  problemRate: 0,
  incomplete: 0,
  running: 0,
  byCategory: {},
  byWeek: [],
  byDay: [],
  turnaroundBuckets: [0, 0, 0, 0, 0, 0],
  byProject: [],
  byEngine: [],
}

const full: ReviewStats = {
  from: Date.UTC(2026, 8, 7),
  to: Date.UTC(2026, 8, 18),
  submissions: 28,
  entries: 4102,
  flagged: 1477,
  repaired: 1400,
  approvable: 2625,
  problemRate: 1477 / 4102,
  medianTurnaroundMs: 2.1 * HOUR,
  incomplete: 2,
  running: 0,
  byCategory: { 'title-case': 560, glossary: 354, 'ai:register': 133 },
  byWeek: [
    { week: '2026-09-07', runs: 12, entries: 1800, flagged: 600 },
    { week: '2026-09-14', runs: 16, entries: 2302, flagged: 877 },
  ],
  byDay: [{ day: '2026-09-08', runs: 28, entries: 4102 }],
  turnaroundBuckets: [2, 5, 9, 6, 4, 2],
  byProject: [
    { project: 'Plugins - Alpha', runs: 3, entries: 900, flagged: 300 },
    { project: 'Malware Removal & Auto Cleanup', runs: 2, entries: 400, flagged: 40 },
  ],
  byEngine: [
    { engine: 'claude:opus', runs: 20, entries: 3000, flagged: 1100, medianTurnaroundMs: 2.4 * HOUR },
    { engine: 'rules', runs: 8, entries: 1102, flagged: 377, medianTurnaroundMs: 4000 },
  ],
}

const drafted: TranslateStats = {
  from: Date.UTC(2026, 8, 7),
  to: Date.UTC(2026, 8, 18),
  runs: 12,
  entries: 7140,
  fuzzy: 1285,
  fuzzyRate: 1285 / 7140,
  skipped: 50,
  medianTurnaroundMs: 5.5 * HOUR,
  incomplete: 1,
  running: 0,
  byWeek: [{ week: '2026-09-14', runs: 12, entries: 7140, flagged: 1285 }],
  byDay: [],
  turnaroundBuckets: [0, 0, 0, 0, 0, 0],
  byProject: [{ project: 'Patterns', runs: 12, entries: 7140, flagged: 1285 }],
  byEngine: [{ engine: 'deepl', runs: 12, entries: 7140, flagged: 1285, medianTurnaroundMs: 5 * HOUR }],
}

const NOW = new Date(Date.UTC(2026, 8, 20))

describe('renderStaticPage', () => {
  it('is a complete page that references nothing off the machine, so it still works offline in a year', () => {
    const html = renderStaticPage(demoPayloads())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/)
  })

  it('carries every range it was given and starts on the widest', () => {
    const html = renderStaticPage(demoPayloads())
    const data = JSON.parse(/id="stats-data">([^<]*)</.exec(html)![1]!)
    expect(data.range).toBe('all')
    expect(Object.keys(data.payloads).sort()).toEqual(['1y', '30d', '90d', 'all'])
  })

  it('takes a single payload too, for a caller that has one', () => {
    const one = demoPayloads()['90d']
    const html = renderStaticPage(one)
    expect(JSON.parse(/id="stats-data">([^<]*)</.exec(html)![1]!).range).toBe('90d')
  })

  it('refuses to render nothing', () => {
    expect(() => renderStaticPage({})).toThrow(/no payload/)
  })
})

describe('renderStats, the older entry from totals', () => {
  it('shows the counts it was given', () => {
    const html = flat(renderStats(full, { now: NOW }))
    expect(html).toContain('4,102')
    expect(html).toContain('28')
    expect(html).toContain('36%')
  })

  it('shows turnaround in hours rather than milliseconds', () => {
    expect(renderStats(full, { now: NOW })).toContain('2.1h')
  })

  it('names flag groups for people', () => {
    const html = renderStats(full, { now: NOW })
    expect(html).toContain('Tone and formality (AI)')
    expect(html).toContain('Glossary term not used')
  })

  it('escapes a project name, because it is text a contributor chose', () => {
    const html = markup(renderStats(full, { now: NOW }))
    expect(html).toContain('Malware Removal &amp; Auto Cleanup')
    expect(html).not.toContain('Malware Removal & Auto')
  })

  it('says how many reviews never finished, rather than omitting them', () => {
    expect(flat(renderStats(full, { now: NOW }))).toContain('2 reviews did not finish')
  })

  it('says there is nothing yet instead of showing zeroes as if they were findings', () => {
    const html = renderStats(empty, { now: NOW })
    expect(html).toContain('No finished reviews have been recorded yet.')
    expect(html).not.toContain('NaN')
  })

  it('says "left fuzzy", never "flagged", for translation, because it is a different claim', () => {
    const html = renderStats(full, { now: NOW, translate: drafted })
    const section = html.slice(html.indexOf('id="translation"'), html.indexOf('id="projects"'))
    expect(section).toContain('left fuzzy')
    expect(section).toContain('skipped by the engine')
    expect(section).not.toMatch(/>flagged</)
  })

  it('compares engines only when more than one ran, since one row compares nothing', () => {
    const html = renderStats(full, { now: NOW, translate: drafted })
    const reviews = html.slice(html.indexOf('id="reviews"'), html.indexOf('id="translation"'))
    const translation = html.slice(html.indexOf('id="translation"'), html.indexOf('id="projects"'))
    expect(reviews).toContain('claude:opus')
    expect(translation).not.toContain('By engine')
  })

  it('carries only the languages it was given', () => {
    const html = markup(renderStats(full, { now: NOW, languages: [] }))
    expect(html).not.toContain('data-lang=')
  })
})
