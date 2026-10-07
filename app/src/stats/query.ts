import type Database from 'better-sqlite3'
import { basename } from 'node:path'
import { parseTally } from '../jobs/json.js'
import { liveRuns } from '../jobs/runs.js'

export interface WeekRow {
  // The Monday the week starts on, as YYYY-MM-DD.
  week: string
  // Named for what it counts in both sections. A review run is one
  // contributor submission and the page labels it so; a translate run is not.
  runs: number
  entries: number
  flagged: number
}

// A calendar day in the local time of the machine that ran the query, for the
// activity heatmap. Local rather than UTC, unlike the weeks: the heatmap is
// about a person's rhythm, and a review finished at 23:30 in Istanbul was done
// that evening, not the next morning. Weeks stay UTC because a few hours of
// drift at a week boundary does not change what a weekly bar says.
export interface DayRow {
  day: string
  runs: number
  entries: number
}

/**
 * Upper bounds of the turnaround buckets, in milliseconds. The last is open.
 * Chosen around how a reviewer experiences the wait: under a minute is "while I
 * watched", up to fifteen is "a coffee", past four hours is "overnight".
 */
export const TURNAROUND_BUCKETS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000, Number.POSITIVE_INFINITY] as const

export interface ProjectRow {
  project: string
  runs: number
  entries: number
  flagged: number
}

// One row per engine that produced work. Review records which model judged, so
// two Claude models appear separately; translate records which draft engine
// wrote. The median is per engine because a slow one is the thing worth seeing.
export interface EngineRow {
  engine: string
  runs: number
  entries: number
  flagged: number
  medianTurnaroundMs?: number
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
  // Started and not yet ended. Shown as "in progress, not yet counted" and
  // never added to a total: a review that has not finished has no totals yet.
  running: number
  byCategory: Record<string, number>
  byWeek: WeekRow[]
  byDay: DayRow[]
  // One count per TURNAROUND_BUCKETS entry, always the full length.
  turnaroundBuckets: number[]
  byProject: ProjectRow[]
  byEngine: EngineRow[]
}

/**
 * What the translate command has drafted.
 *
 * Deliberately a separate figure from the review side rather than folded in.
 * `flagged` there means the tool thinks something is wrong; `fuzzy` here means
 * the draft wants a human eye. Summing them would produce a number that
 * answers no question.
 */
export interface TranslateStats {
  from?: number
  to?: number
  runs: number
  entries: number
  fuzzy: number
  fuzzyRate: number
  // Entries in batches an engine gave up on. Never drafted at all, so kept
  // apart from `fuzzy`: folding them together would hide an engine that keeps
  // failing behind a plausible-looking quality figure.
  skipped: number
  medianTurnaroundMs?: number
  incomplete: number
  running: number
  byWeek: WeekRow[]
  byDay: DayRow[]
  turnaroundBuckets: number[]
  byProject: ProjectRow[]
  byEngine: EngineRow[]
}

export interface StatsWindow {
  since?: number
}

interface Row {
  file: string
  project: string | null
  engine: string
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

// The command is bound like the date, not spliced into the SQL. It used to be
// spliced, which was safe only because the argument is a two-member union; the
// next person to widen that union would not have known the query depended on it.
function finishedRuns(db: Database.Database, command: 'review' | 'translate', since: number): Row[] {
  return db
    .prepare<[string, number], Row>(
      `SELECT file, project, engine, started_at, finished_at, entries, flagged, repaired, approvable, by_category
       FROM run
       WHERE command = ? AND state = 'done' AND started_at >= ?
       ORDER BY started_at`,
    )
    .all(command, since)
}

// Not windowed: a run in progress started recently by definition, and the
// question it answers is "is something happening now". Counted through
// liveRuns, which checks the pid, rather than by state alone: a kill -9
// leaves its row at running until the next start reaps it, and the page would
// otherwise say "in progress" about a process that is gone. liveRuns reads and
// never writes, which keeps the server read-only.
function runningRuns(db: Database.Database, command: 'review' | 'translate'): number {
  return liveRuns(db).filter((r) => r.command === command).length
}

function dayOf(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function bucketOf(ms: number): number {
  return TURNAROUND_BUCKETS.findIndex((edge) => ms < edge)
}

// Runs that really did not finish, which is narrower than "not done".
//
// A run the operator stopped is not a fault: stopping part way to look at the
// output and resuming later is ordinary use, and the work so far is cached, so
// counting it here would put a warning on the page for a workflow working
// exactly as intended. Only a throw and a killed process count.
//
// A row from before the `ended` column cannot say how it ended, and is not
// counted: the commonest way a run stopped was the operator stopping it, so
// treating the unknown as a fault invents crashes that mostly did not happen.
// The cost is that a genuine old crash goes unreported, which is the quieter
// of the two wrong answers.
//
// A row still at `running` is excluded by the same rule, and the reaper turns
// a dead one into `abandoned`, at which point it is counted.
function unfinishedRuns(db: Database.Database, command: 'review' | 'translate', since: number): number {
  return db
    .prepare<[string, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM run
       WHERE command = ? AND ended IN ('failed', 'abandoned') AND started_at >= ?`,
    )
    .get(command, since)!.n
}

interface Grouped {
  entries: number
  flagged: number
  repaired: number
  approvable: number
  turnarounds: number[]
  categories: Map<string, number>
  weeks: Map<string, WeekRow>
  days: Map<string, DayRow>
  buckets: number[]
  projects: Map<string, ProjectRow>
  engines: Map<string, { row: EngineRow; turnarounds: number[] }>
}

// Both commands roll up the same way and differ only in what the columns are
// called afterwards, so the rolling up happens once.
function group(rows: Row[]): Grouped {
  const g: Grouped = {
    entries: 0,
    flagged: 0,
    repaired: 0,
    approvable: 0,
    turnarounds: [],
    categories: new Map(),
    weeks: new Map(),
    days: new Map(),
    buckets: TURNAROUND_BUCKETS.map(() => 0),
    projects: new Map(),
    engines: new Map(),
  }

  for (const row of rows) {
    const entries = row.entries ?? 0
    const flagged = row.flagged ?? 0
    g.entries += entries
    g.flagged += flagged
    g.repaired += row.repaired ?? 0
    g.approvable += row.approvable ?? 0

    const took = row.finished_at === null ? undefined : row.finished_at - row.started_at
    if (took !== undefined) {
      g.turnarounds.push(took)
      g.buckets[bucketOf(took)]! += 1
    }

    const today = dayOf(row.started_at)
    const d = g.days.get(today) ?? { day: today, runs: 0, entries: 0 }
    d.runs += 1
    d.entries += entries
    g.days.set(today, d)

    for (const [name, n] of Object.entries(parseTally(row.by_category) ?? {})) {
      g.categories.set(name, (g.categories.get(name) ?? 0) + n)
    }

    const week = weekOf(row.started_at)
    const w = g.weeks.get(week) ?? { week, runs: 0, entries: 0, flagged: 0 }
    w.runs += 1
    w.entries += entries
    w.flagged += flagged
    g.weeks.set(week, w)

    // A .po that declared no Project-Id-Version still has to appear as
    // something a human recognises, and its file name is what they chose.
    const name = row.project ?? basename(row.file)
    const p = g.projects.get(name) ?? { project: name, runs: 0, entries: 0, flagged: 0 }
    p.runs += 1
    p.entries += entries
    p.flagged += flagged
    g.projects.set(name, p)

    const e = g.engines.get(row.engine) ?? {
      row: { engine: row.engine, runs: 0, entries: 0, flagged: 0 },
      turnarounds: [],
    }
    e.row.runs += 1
    e.row.entries += entries
    e.row.flagged += flagged
    if (took !== undefined) e.turnarounds.push(took)
    g.engines.set(row.engine, e)
  }

  return g
}

function weeksOf(g: Grouped): WeekRow[] {
  return [...g.weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
}

function daysOf(g: Grouped): DayRow[] {
  return [...g.days.values()].sort((a, b) => a.day.localeCompare(b.day))
}

function projectsOf(g: Grouped): ProjectRow[] {
  return [...g.projects.values()].sort((a, b) => b.entries - a.entries)
}

// Ordered by entries so the engine doing the work leads, which is the question
// a comparison table is usually asked.
function enginesOf(g: Grouped): EngineRow[] {
  return [...g.engines.values()]
    .map(({ row, turnarounds }) => {
      const mid = median(turnarounds)
      return mid === undefined ? row : { ...row, medianTurnaroundMs: mid }
    })
    .sort((a, b) => b.entries - a.entries)
}

/**
 * What the review command has done, from the frozen per-run totals.
 *
 * Only finished reviews contribute. A run that stopped part way froze no
 * totals, on purpose: a review that did not look at every entry has no honest
 * throughput or problem rate to report. Translate runs are reported separately
 * by translateStats; summing the two would add a count of "looks wrong" to a
 * count of "wants a human eye" and produce a number answering no question.
 */
export function reviewStats(db: Database.Database, window: StatsWindow = {}): ReviewStats {
  const since = window.since ?? 0
  const rows = finishedRuns(db, 'review', since)
  const stats: ReviewStats = {
    submissions: rows.length,
    entries: 0,
    flagged: 0,
    repaired: 0,
    approvable: 0,
    problemRate: 0,
    incomplete: unfinishedRuns(db, 'review', since),
    running: runningRuns(db, 'review'),
    byCategory: {},
    byWeek: [],
    byDay: [],
    turnaroundBuckets: TURNAROUND_BUCKETS.map(() => 0),
    byProject: [],
    byEngine: [],
  }
  if (rows.length === 0) return stats

  const g = group(rows)
  stats.from = rows[0]!.started_at
  stats.to = rows[rows.length - 1]!.started_at
  stats.entries = g.entries
  stats.flagged = g.flagged
  stats.repaired = g.repaired
  stats.approvable = g.approvable
  stats.problemRate = g.entries === 0 ? 0 : g.flagged / g.entries
  const turnaround = median(g.turnarounds)
  if (turnaround !== undefined) stats.medianTurnaroundMs = turnaround
  stats.byCategory = byValueDescending(g.categories)
  stats.byWeek = weeksOf(g)
  stats.byDay = daysOf(g)
  stats.turnaroundBuckets = g.buckets
  stats.byProject = projectsOf(g)
  stats.byEngine = enginesOf(g)
  return stats
}

/**
 * What the translate command has drafted.
 *
 * `fuzzy` is the run's `flagged` column read for what it means on this side: a
 * draft the engine or its review wants a human to look at. `skipped` is the
 * `unreviewed` column, entries in batches an engine gave up on, which were
 * never drafted at all.
 */
export function translateStats(db: Database.Database, window: StatsWindow = {}): TranslateStats {
  const since = window.since ?? 0
  const rows = finishedRuns(db, 'translate', since)
  const stats: TranslateStats = {
    runs: rows.length,
    entries: 0,
    fuzzy: 0,
    fuzzyRate: 0,
    skipped: 0,
    incomplete: unfinishedRuns(db, 'translate', since),
    running: runningRuns(db, 'translate'),
    byWeek: [],
    byDay: [],
    turnaroundBuckets: TURNAROUND_BUCKETS.map(() => 0),
    byProject: [],
    byEngine: [],
  }
  if (rows.length === 0) return stats

  const g = group(rows)
  stats.from = rows[0]!.started_at
  stats.to = rows[rows.length - 1]!.started_at
  stats.entries = g.entries
  stats.fuzzy = g.flagged
  stats.fuzzyRate = g.entries === 0 ? 0 : g.flagged / g.entries
  // `unreviewed` on a translate row is the batches its engine gave up on.
  stats.skipped = db
    .prepare<[number], { n: number | null }>(
      `SELECT SUM(unreviewed) AS n FROM run WHERE command = 'translate' AND state = 'done' AND started_at >= ?`,
    )
    .get(since)!.n ?? 0
  const turnaround = median(g.turnarounds)
  if (turnaround !== undefined) stats.medianTurnaroundMs = turnaround
  stats.byWeek = weeksOf(g)
  stats.byDay = daysOf(g)
  stats.turnaroundBuckets = g.buckets
  stats.byProject = projectsOf(g)
  stats.byEngine = enginesOf(g)
  return stats
}
