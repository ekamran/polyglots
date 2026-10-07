import { describe, expect, it } from 'vitest'
import { demoPayloads } from '../../src/stats/demo.js'
import { ENGLISH, type StatsLanguage } from '../../src/stats/i18n.js'
import { heatmapStart, type StatsPayload } from '../../src/stats/page/model.js'
import { PROJECTS_SHOWN, VIEWS, renderRoot } from '../../src/stats/page/views.js'
import { STATS_TRANSLATIONS } from '../../src/stats/translations-data.js'

const TR = STATS_TRANSLATIONS.find((l) => l.tag === 'tr')!
const demo = demoPayloads()
const flat = (html: string) => html.replace(/\s+/g, ' ')

function render(payload: StatsPayload, lang: StatsLanguage = ENGLISH): string {
  return renderRoot({ payload, lang, languages: [ENGLISH, TR] })
}

function emptyPayload(): StatsPayload {
  const zero = { incomplete: 0, running: 0, byWeek: [], byDay: [], turnaroundBuckets: [0, 0, 0, 0, 0, 0], byProject: [], byEngine: [] }
  return {
    range: 'all',
    generatedAt: Date.UTC(2026, 9, 7),
    review: { ...zero, submissions: 0, entries: 0, flagged: 0, repaired: 0, approvable: 0, problemRate: 0, byCategory: {} },
    translate: { ...zero, runs: 0, entries: 0, fuzzy: 0, fuzzyRate: 0, skipped: 0 },
    activity: [],
    recent: { submissions: 0, entries: 0, flagged: 0, drafted: 0 },
  }
}

describe('renderRoot', () => {
  it('renders every view as its own section with a nav link, so the page reads without JavaScript', () => {
    const html = render(demo.all)
    for (const v of VIEWS) {
      expect(html).toContain(`<section class="view" id="${v}"`)
      expect(html).toContain(`href="#${v}"`)
    }
  })

  it('names flag groups for people, never by their raw key', () => {
    const html = render(demo.all)
    expect(html).toContain('Tone and formality (AI)')
    expect(html).toContain('Title case')
    expect(html).not.toMatch(/>ai:register</)
  })

  it('splits rule checks from AI findings in the legend', () => {
    const page = render(demo.all)
    const html = page.slice(page.indexOf('<ul class="legend">'))
    const rules = html.indexOf('Rule checks')
    const ai = html.indexOf('AI review')
    expect(rules).toBeGreaterThan(-1)
    expect(ai).toBeGreaterThan(rules)
    expect(html.indexOf('Title case')).toBeLessThan(ai)
    expect(html.indexOf('Tone and formality (AI)')).toBeGreaterThan(ai)
  })

  it('makes every donut segment and legend row keyboard reachable with a tooltip', () => {
    const html = render(demo.all)
    expect(html).toMatch(/<circle class="slice[^>]*tabindex="0"[^>]*data-tip-title="[^"]+"/)
    expect(html).toMatch(/<li tabindex="0" data-tip-title="[^"]+" data-tip-body="[^"]+" data-tip-meta="[^"]+"/)
  })

  it('shows the biggest projects and puts the rest behind a details element', () => {
    const html = render(demo.all)
    const total = demo.all.review.byProject.length
    expect(total).toBeGreaterThan(PROJECTS_SHOWN)
    expect(html).toContain(`<summary>Show all ${total} projects</summary>`)
    const top = html.slice(html.indexOf('class="sortable proj-top"'), html.indexOf('</table>', html.indexOf('class="sortable proj-top"')))
    expect(top.match(/<tr>/g)).toHaveLength(PROJECTS_SHOWN + 1)
  })

  it('keeps the raw number for sorting beside the formatted one', () => {
    const html = render(demo.all, TR)
    const biggest = [...demo.all.review.byProject].sort((a, b) => b.entries - a.entries)[0]!
    expect(html).toContain(`data-v="${biggest.entries}">${biggest.entries.toLocaleString('tr')}</td>`)
  })

  it('escapes project names, which contributors choose', () => {
    const p = structuredClone(demo['30d'])
    p.review.byProject = [{ project: '<img src=x onerror=alert(1)> & co', runs: 1, entries: 5, flagged: 1 }]
    const html = render(p)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co')
  })

  it('prints figures the way the language writes them', () => {
    const html = render(demo.all, TR)
    expect(html).toContain(demo.all.review.entries.toLocaleString('tr'))
    expect(html).toContain('Kural denetimleri')
  })

  it('says a review is in progress without counting it', () => {
    const p = structuredClone(demo['30d'])
    p.review.running = 2
    expect(flat(render(p))).toContain('2 reviews in progress, not counted until they finish.')
  })

  it('offers each range and marks the current one', () => {
    const html = render(demo['90d'])
    expect(html).toContain('href="?range=90d" data-range="90d" aria-current="true"')
    expect(html).toContain('href="?range=30d" data-range="30d">')
    expect(html).toContain('href="?range=90d&amp;lang=tr" data-lang="tr" lang="tr"')
  })

  it('shows a year of activity whatever the range', () => {
    const html = render(demo['30d'])
    const heat = html.slice(html.indexOf('class="heat"'), html.indexOf('</svg>', html.indexOf('class="heat"')))
    expect((heat.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(365)
  })

  it('reads as an empty state rather than a page of zeroes when nothing is recorded', () => {
    const html = render(emptyPayload())
    expect(html).toContain('No finished reviews have been recorded yet.')
    expect(html).not.toContain('NaN')
  })

  // The heatmap is in local time, so the dates printed above it have to be
  // too, or the two disagree for anyone far from UTC.
  it('prints the span and the generated date in local time, like the heatmap', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Pacific/Kiritimati'
    try {
      const p = emptyPayload()
      p.generatedAt = Date.UTC(2026, 9, 7, 12)
      p.review.from = Date.UTC(2026, 8, 1, 12)
      p.review.to = Date.UTC(2026, 9, 6, 12)
      const html = flat(render(p))
      expect(html).toContain('2026-09-02 to 2026-10-07 · generated 2026-10-08')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('fills the heatmap from its first column when there is data there', () => {
    const p = emptyPayload()
    p.generatedAt = Date.UTC(2026, 9, 7, 12)
    const start = new Date(heatmapStart(p.generatedAt))
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
    p.activity = [{ day, runs: 1, entries: 5 }]
    p.review.submissions = 1
    const html = render(p)
    const heat = html.slice(html.indexOf('class="heat"'))
    expect(heat).toMatch(/<rect class="h4" x="0" y="0"/)
  })

  it('never ranks contributors, and says so', () => {
    const html = render(demo.all)
    expect(html).toContain('This page never ranks contributors')
    expect(html.toLowerCase()).not.toContain('contributor</th>')
  })

  it('keeps the caveat that a flag is about the tool, not the person', () => {
    expect(render(demo.all)).toContain('a flag is not a judgement about the contributor')
  })
})
