import { describe, expect, it } from 'vitest'
import { renderStats } from '../../src/stats/render.js'
import type { ReviewStats } from '../../src/stats/query.js'

const HOUR = 3_600_000

const empty: ReviewStats = {
  submissions: 0,
  entries: 0,
  flagged: 0,
  repaired: 0,
  approvable: 0,
  problemRate: 0,
  incomplete: 0,
  byCategory: {},
  byWeek: [],
  byProject: [],
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
  byCategory: { 'title-case': 560, glossary: 354, placeholder: 133 },
  byWeek: [
    { week: '2026-09-07', submissions: 12, entries: 1800, flagged: 600 },
    { week: '2026-09-14', submissions: 16, entries: 2302, flagged: 877 },
  ],
  byProject: [
    { project: 'Plugins - Alpha', submissions: 3, entries: 900, flagged: 300 },
    { project: 'Plugins - Beta', submissions: 2, entries: 400, flagged: 40 },
  ],
}

describe('renderStats produces a self-contained page', () => {
  it('is a complete HTML document', () => {
    const html = renderStats(full)
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('</html>')
  })

  it('references nothing off the machine, so it still works offline in a year', () => {
    const html = renderStats(full)
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link[^>]+href="https?:/i)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('carries no script at all, so it can be mailed without tripping a filter', () => {
    // The theme and language switches are CSS, not JavaScript, precisely so
    // this stays true.
    expect(renderStats(full)).not.toMatch(/<script/i)
    expect(renderStats(full)).not.toMatch(/\son[a-z]+=/i)
  })
})

describe('renderStats headline numbers', () => {
  it('shows the counts it was given', () => {
    const html = renderStats(full)
    expect(html).toContain('28')
    expect(html).toContain('4,102')
  })

  it('shows the problem rate as a whole percentage', () => {
    // 1477/4102 = 36.0%
    expect(renderStats(full)).toContain('36%')
  })

  it('shows turnaround in hours rather than milliseconds', () => {
    const html = renderStats(full)
    expect(html).toContain('2.1h')
    expect(html).not.toContain('7560000')
  })

  it('says how many reviews never finished, rather than omitting them', () => {
    // Tags sit between the count and the phrase now that both languages are
    // carried, so this asserts they are associated rather than adjacent.
    expect(renderStats(full)).toMatch(/2\s*(?:<[^>]+>\s*)*reviews? did not finish/i)
  })

  it('leaves the incomplete line out entirely when every run finished', () => {
    const html = renderStats({ ...full, incomplete: 0 })
    expect(html).not.toMatch(/did not finish|never finished/i)
  })
})

describe('renderStats weekly chart', () => {
  it('draws one bar per week', () => {
    const html = renderStats(full)
    expect(html.match(/<rect[^>]*class="bar"/g) ?? []).toHaveLength(2)
  })

  it('scales the tallest bar to full height and the others in proportion', () => {
    const html = renderStats({
      ...full,
      byWeek: [
        { week: '2026-09-07', submissions: 1, entries: 50, flagged: 0 },
        { week: '2026-09-14', submissions: 1, entries: 100, flagged: 0 },
      ],
    })
    const heights = [...html.matchAll(/<rect[^>]*class="bar"[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(heights).toHaveLength(2)
    expect(heights[0]! / heights[1]!).toBeCloseTo(0.5, 2)
  })

  it('does not divide by zero when every week is empty', () => {
    const html = renderStats({
      ...full,
      byWeek: [{ week: '2026-09-07', submissions: 1, entries: 0, flagged: 0 }],
    })
    expect(html).not.toContain('NaN')
  })
})

describe('renderStats category donut', () => {
  it('draws one segment per category', () => {
    const html = renderStats(full)
    expect(html.match(/class="seg"/g) ?? []).toHaveLength(3)
  })

  it('gives each segment a length proportional to its share', () => {
    const html = renderStats({ ...full, byCategory: { a: 75, b: 25 } })
    const dashes = [...html.matchAll(/stroke-dasharray="([\d.]+) /g)].map((m) => Number(m[1]))
    expect(dashes[0]! / dashes[1]!).toBeCloseTo(3, 2)
  })

  it('names each category with its share', () => {
    const html = renderStats({ ...full, byCategory: { 'title-case': 3, glossary: 1 } })
    expect(html).toContain('title-case')
    expect(html).toContain('75%')
  })
})

describe('renderStats project table', () => {
  it('lists each project with its counts', () => {
    const html = renderStats(full)
    expect(html).toContain('Plugins - Alpha')
    expect(html).toContain('900')
  })

  it('escapes a project name, because it is text a contributor chose', () => {
    // Real Project-Id-Version headers carry ampersands: "Antivirus, Malware
    // Removal &amp; Auto Cleanup". Unescaped, a name could also close a tag.
    const html = renderStats({
      ...full,
      byProject: [{ project: 'Anti & <script>alert(1)</script> Malware', submissions: 1, entries: 1, flagged: 0 }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('renderStats with nothing recorded', () => {
  it('still renders a real page', () => {
    const html = renderStats(empty)
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('</html>')
  })

  it('says there is nothing yet instead of showing zeroes as if they were findings', () => {
    expect(renderStats(empty)).toMatch(/no (reviews|finished reviews)/i)
  })

  it('shows no NaN where a rate would divide by zero', () => {
    expect(renderStats(empty)).not.toContain('NaN')
  })

  it('draws no empty chart frames', () => {
    const html = renderStats(empty)
    expect(html.match(/class="seg"/g) ?? []).toHaveLength(0)
    expect(html.match(/<rect[^>]*class="bar"/g) ?? []).toHaveLength(0)
  })
})

describe('renderStats is honest about what it measures', () => {
  it('says the flag rate is about this tool, not about contributors', () => {
    // These numbers may be posted where the people who volunteered the
    // translations will read them.
    expect(renderStats(full)).toMatch(/flagged by polyglots|what this tool flags|not a judgement/i)
  })

  it('states the span the numbers actually cover', () => {
    const html = renderStats(full)
    expect(html).toContain('2026-09-07')
    expect(html).toContain('2026-09-18')
  })
})

describe('renderStats theme switch', () => {
  it('offers auto, light and dark', () => {
    const html = renderStats(full)
    for (const id of ['theme-auto', 'theme-light', 'theme-dark']) expect(html).toContain(id)
  })

  it('defaults to following the system, so a shared page matches the reader', () => {
    const html = renderStats(full)
    expect(html).toMatch(/id="theme-auto"[^>]*checked/)
    expect(html).toContain('prefers-color-scheme')
  })

  it('switches with CSS rather than script', () => {
    const html = renderStats(full)
    expect(html).toContain(':has(#theme-dark:checked)')
    expect(html).toContain(':has(#theme-light:checked)')
  })
})

describe('renderStats language switch', () => {
  it('carries both languages in the page', () => {
    const html = renderStats(full)
    expect(html).toContain('submissions reviewed')
    expect(html).toContain('incelenen gönderi')
  })

  it('marks the Turkish as Turkish, so uppercasing an i does not lose its dot', () => {
    // text-transform on a heading turns "istatistik" into "ISTATISTIK" unless
    // the element says it is Turkish, where it correctly gives "İSTATİSTİK".
    const html = renderStats(full)
    expect(html).toMatch(/lang="tr"/)
  })

  it('defaults to English and shows one language at a time', () => {
    const html = renderStats(full)
    expect(html).toMatch(/id="lang-en"[^>]*checked/)
    expect(html).toContain(':has(#lang-tr:checked)')
  })

  it('formats numbers the way each language does', () => {
    const html = renderStats(full)
    expect(html).toContain('4,102')
    expect(html).toContain('4.102')
  })

  it('translates the caveat too, since that is the part that needs care', () => {
    expect(renderStats(full)).toContain('katkıcı hakkında bir yargı değildir')
  })

  it('translates the empty state', () => {
    expect(renderStats(empty)).toContain('Henüz tamamlanmış inceleme')
  })
})
