import type Database from 'better-sqlite3'
import { basename } from 'node:path'
import { parseTally } from '../jobs/json.js'

export interface WeekRow {
  // The Monday the week starts on, as YYYY-MM-DD.
  week: string
  submissions: number
  entries: number
  flagged: number
}

export interface ProjectRow {
  project: string
  submissions: number
  entries: number
  flagged: number
}

export interface ReviewStats {
  // The span the counted runs actually cover, which is narrower than any window
  // that was asked for. The page prints this, and printing the requested window
  // instead would overstate how much history is behind the numbers.
  from?: number
  to?: number
  submissions: number
  entries: number
  flagged: number
  repaired: number
  approvable: number
  // Share of entries flagged, not the mean of each run's rate: a 5-entry
  // submission should not weigh as much as a 500-entry one.
  problemRate: number
  medianTurnaroundMs?: number
  // Reviews that were started and never finished, so they froze no totals and
  // are absent from every number above. Counted so the page can say they
  // happened rather than quietly shrinking the denominator.
  incomplete: number
  byCategory: Record<string, number>
  byWeek: WeekRow[]
  byProject: ProjectRow[]
}

export interface StatsWindow {
  since?: number
}

interface Row {
  file: string
  project: string | null
  started_at: number
  finished_at: number | null
  entries: number | null
  flagged: number | null
  repaired: number | null
  approvable: number | null
  by_category: string | null
}

// Monday of the week containing `at`, in UTC. UTC rather than local time so the
// buckets are the same wherever this runs; a few hours of drift at a week
// boundary does not change what a weekly bar chart says.
function weekOf(at: number): string {
  const d = new Date(at)
  const sinceMonday = (d.getUTCDay() + 6) % 7
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)
  return new Date(monday).toISOString().slice(0, 10)
}

// The median, not the mean: one overnight run over a 7000-entry file would
// otherwise swamp a month of ordinary submissions.
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function byValueDescending(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].sort(([, a], [, b]) => b - a))
}

/**
 * What the review command has done, from the frozen per-run totals.
 *
 * Only finished reviews contribute. A run that stopped part way froze no
 * totals, on purpose: a review that did not look at every entry has no honest
 * throughput or problem rate to report. Translate runs are excluded entirely —
 * they measure drafting, not reviewing, and mixing them would make both
 * numbers mean nothing.
 */
export function reviewStats(db: Database.Database, window: StatsWindow = {}): ReviewStats {
  const since = window.since ?? 0

  const rows = db
    .prepare<[number], Row>(
      `SELECT file, project, started_at, finished_at, entries, flagged, repaired, approvable, by_category
       FROM run
       WHERE command = 'review' AND state = 'done' AND started_at >= ?
       ORDER BY started_at`,
    )
    .all(since)

  const incomplete = db
    .prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n FROM run WHERE command = 'review' AND state <> 'done' AND started_at >= ?`,
    )
    .get(since)!.n

  const stats: ReviewStats = {
    submissions: rows.length,
    entries: 0,
    flagged: 0,
    repaired: 0,
    approvable: 0,
    problemRate: 0,
    incomplete,
    byCategory: {},
    byWeek: [],
    byProject: [],
  }
  if (rows.length === 0) return stats

  const turnarounds: number[] = []
  const categories = new Map<string, number>()
  const weeks = new Map<string, WeekRow>()
  const projects = new Map<string, ProjectRow>()

  for (const row of rows) {
    const entries = row.entries ?? 0
    const flagged = row.flagged ?? 0
    stats.entries += entries
    stats.flagged += flagged
    stats.repaired += row.repaired ?? 0
    stats.approvable += row.approvable ?? 0

    if (row.finished_at !== null) turnarounds.push(row.finished_at - row.started_at)

    for (const [name, n] of Object.entries(parseTally(row.by_category) ?? {})) {
      categories.set(name, (categories.get(name) ?? 0) + n)
    }

    const week = weekOf(row.started_at)
    const w = weeks.get(week) ?? { week, submissions: 0, entries: 0, flagged: 0 }
    w.submissions += 1
    w.entries += entries
    w.flagged += flagged
    weeks.set(week, w)

    // A .po that declared no Project-Id-Version still has to appear as
    // something a human recognises, and its file name is what they chose.
    const name = row.project ?? basename(row.file)
    const p = projects.get(name) ?? { project: name, submissions: 0, entries: 0, flagged: 0 }
    p.submissions += 1
    p.entries += entries
    p.flagged += flagged
    projects.set(name, p)
  }

  stats.from = rows[0]!.started_at
  stats.to = rows[rows.length - 1]!.started_at
  stats.problemRate = stats.entries === 0 ? 0 : stats.flagged / stats.entries
  const turnaround = median(turnarounds)
  if (turnaround !== undefined) stats.medianTurnaroundMs = turnaround
  stats.byCategory = byValueDescending(categories)
  stats.byWeek = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
  stats.byProject = [...projects.values()].sort((a, b) => b.entries - a.entries)
  return stats
}
