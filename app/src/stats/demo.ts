import type { DayRow, EngineRow, ProjectRow, ReviewStats, TranslateStats, WeekRow } from './query.js'
import { TURNAROUND_BUCKETS } from './query.js'
import { RANGES, RANGE_DAYS, type Range, type StatsPayload } from './page/model.js'

// A synthetic history for the website's sample page and for tests: invented
// projects, invented numbers, no contributor anywhere. Deterministic, so a
// screenshot or a size budget does not change between runs.
//
// Built by simulating runs and rolling them up the same way query.ts does,
// rather than by writing totals by hand, so the four ranges agree with each
// other the way real ones would.

const DAY = 86_400_000

const PROJECTS = [
  'Lumen Forms',
  'Harbor Booking',
  'Quill SEO Toolkit',
  'Orchard Gallery',
  'Atlas Maps & Places',
  'Beacon Newsletter',
  'Cedar Membership',
  'Drift Slider',
  'Ember Events Calendar',
  'Fern Recipes',
  'Granite Security',
  'Juniper Shop Add-ons',
  'Kestrel Backup',
  'Lark Contact Widgets',
]

const RULES = [
  'title-case',
  'glossary',
  'punctuation',
  'placeholder',
  'ampersand',
  'whitespace',
  'tm-conflict',
  'ai:register',
  'ai:meaning',
  'ai:fluency',
  'ai:glossary',
]

interface Run {
  at: number
  project: string
  engine: string
  entries: number
  flagged: number
  took: number
  command: 'review' | 'translate'
  byCategory: Record<string, number>
}

// A small linear congruential generator: deterministic and dependency-free.
function random(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function simulate(now: number): Run[] {
  const next = random(12)
  const runs: Run[] = []
  for (let day = 420; day >= 0; day--) {
    // Quieter at weekends and in August, the way a volunteer locale is.
    const date = new Date(now - day * DAY)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    const chance = (weekend ? 0.2 : 0.55) * (date.getUTCMonth() === 7 ? 0.4 : 1)
    if (next() > chance) continue
    const reviews = 1 + Math.floor(next() * 2.2)
    for (let i = 0; i < reviews; i++) {
      const entries = 20 + Math.floor(next() ** 2 * 600)
      const flagged = Math.floor(entries * (0.04 + next() * 0.18))
      const byCategory: Record<string, number> = {}
      for (let f = 0; f < flagged; f++) {
        const rule = RULES[Math.floor(next() ** 1.6 * RULES.length)]!
        byCategory[rule] = (byCategory[rule] ?? 0) + 1
      }
      runs.push({
        at: now - day * DAY + Math.floor(next() * 10 * 3_600_000),
        project: PROJECTS[Math.floor(next() ** 1.4 * PROJECTS.length)]!,
        engine: next() < 0.7 ? 'claude-sonnet' : 'gemini-flash',
        entries,
        flagged,
        took: 30_000 + Math.floor(next() ** 3 * 5 * 3_600_000),
        command: 'review',
        byCategory,
      })
    }
    if (next() < 0.15) {
      const entries = 200 + Math.floor(next() * 3000)
      runs.push({
        at: now - day * DAY,
        project: PROJECTS[Math.floor(next() * PROJECTS.length)]!,
        engine: next() < 0.6 ? 'deepl' : 'openai',
        entries,
        flagged: Math.floor(entries * (0.08 + next() * 0.12)),
        took: 600_000 + Math.floor(next() * 3 * 3_600_000),
        command: 'translate',
        byCategory: {},
      })
    }
  }
  return runs.sort((a, b) => a.at - b.at)
}

function weekOf(at: number): string {
  const d = new Date(at)
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return new Date(monday).toISOString().slice(0, 10)
}

function dayOf(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

interface Rolled {
  entries: number
  flagged: number
  byWeek: WeekRow[]
  byDay: DayRow[]
  byProject: ProjectRow[]
  byEngine: EngineRow[]
  buckets: number[]
  median?: number
  from?: number
  to?: number
}

function roll(runs: Run[]): Rolled {
  const weeks = new Map<string, WeekRow>()
  const days = new Map<string, DayRow>()
  const projects = new Map<string, ProjectRow>()
  const engines = new Map<string, EngineRow & { took: number[] }>()
  const buckets = TURNAROUND_BUCKETS.map(() => 0)
  for (const r of runs) {
    const w = weeks.get(weekOf(r.at)) ?? { week: weekOf(r.at), runs: 0, entries: 0, flagged: 0 }
    w.runs += 1
    w.entries += r.entries
    w.flagged += r.flagged
    weeks.set(w.week, w)
    const d = days.get(dayOf(r.at)) ?? { day: dayOf(r.at), runs: 0, entries: 0 }
    d.runs += 1
    d.entries += r.entries
    days.set(d.day, d)
    const p = projects.get(r.project) ?? { project: r.project, runs: 0, entries: 0, flagged: 0 }
    p.runs += 1
    p.entries += r.entries
    p.flagged += r.flagged
    projects.set(r.project, p)
    const e = engines.get(r.engine) ?? { engine: r.engine, runs: 0, entries: 0, flagged: 0, took: [] }
    e.runs += 1
    e.entries += r.entries
    e.flagged += r.flagged
    e.took.push(r.took)
    engines.set(r.engine, e)
    buckets[TURNAROUND_BUCKETS.findIndex((edge) => r.took < edge)]! += 1
  }
  const mid = median(runs.map((r) => r.took))
  return {
    entries: runs.reduce((n, r) => n + r.entries, 0),
    flagged: runs.reduce((n, r) => n + r.flagged, 0),
    byWeek: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: [...projects.values()].sort((a, b) => b.entries - a.entries),
    byEngine: [...engines.values()]
      .map(({ took, ...row }) => {
        const m = median(took)
        return m === undefined ? row : { ...row, medianTurnaroundMs: m }
      })
      .sort((a, b) => b.entries - a.entries),
    buckets,
    ...(mid === undefined ? {} : { median: mid }),
    ...(runs.length === 0 ? {} : { from: runs[0]!.at, to: runs[runs.length - 1]!.at }),
  }
}

function reviewOf(runs: Run[]): ReviewStats {
  const g = roll(runs)
  const byCategory: Record<string, number> = {}
  for (const r of runs) for (const [k, n] of Object.entries(r.byCategory)) byCategory[k] = (byCategory[k] ?? 0) + n
  return {
    ...(g.from === undefined ? {} : { from: g.from, to: g.to! }),
    submissions: runs.length,
    entries: g.entries,
    flagged: g.flagged,
    repaired: Math.round(g.flagged * 0.8),
    approvable: g.entries - g.flagged,
    problemRate: g.entries === 0 ? 0 : g.flagged / g.entries,
    ...(g.median === undefined ? {} : { medianTurnaroundMs: g.median }),
    incomplete: runs.length > 10 ? 1 : 0,
    running: 0,
    byCategory: Object.fromEntries(Object.entries(byCategory).sort(([, a], [, b]) => b - a)),
    byWeek: g.byWeek,
    byDay: g.byDay,
    turnaroundBuckets: g.buckets,
    byProject: g.byProject,
    byEngine: g.byEngine,
  }
}

function translateOf(runs: Run[]): TranslateStats {
  const g = roll(runs)
  return {
    ...(g.from === undefined ? {} : { from: g.from, to: g.to! }),
    runs: runs.length,
    entries: g.entries,
    fuzzy: g.flagged,
    fuzzyRate: g.entries === 0 ? 0 : g.flagged / g.entries,
    skipped: 0,
    ...(g.median === undefined ? {} : { medianTurnaroundMs: g.median }),
    incomplete: 0,
    running: 0,
    byWeek: g.byWeek,
    byDay: g.byDay,
    turnaroundBuckets: g.buckets,
    byProject: g.byProject,
    byEngine: g.byEngine,
  }
}

/** A payload per range, from a synthetic year and a bit of review history ending at `now`. */
export function demoPayloads(now: Date = new Date(Date.UTC(2026, 9, 7, 12))): Record<Range, StatsPayload> {
  const all = simulate(now.getTime())
  const after = (days: number) => all.filter((r) => r.at >= now.getTime() - days * DAY)
  const pick = (runs: Run[], command: Run['command']) => runs.filter((r) => r.command === command)
  const month = after(30)
  const recent = {
    submissions: pick(month, 'review').length,
    entries: pick(month, 'review').reduce((n, r) => n + r.entries, 0),
    flagged: pick(month, 'review').reduce((n, r) => n + r.flagged, 0),
    drafted: pick(month, 'translate').reduce((n, r) => n + r.entries, 0),
  }
  const activity = roll(pick(after(365), 'review')).byDay
  return Object.fromEntries(
    RANGES.map((range) => {
      const runs = range === 'all' ? all : after(RANGE_DAYS[range])
      const payload: StatsPayload = {
        range,
        generatedAt: now.getTime(),
        review: reviewOf(pick(runs, 'review')),
        translate: translateOf(pick(runs, 'translate')),
        activity,
        recent,
      }
      return [range, payload]
    }),
  ) as Record<Range, StatsPayload>
}
