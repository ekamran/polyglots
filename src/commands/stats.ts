import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../jobs/index.js'
import { reviewStats, translateStats, type ProjectRow } from '../stats/query.js'
import { renderStats } from '../stats/render.js'

export const DEFAULT_STATS_FILE = 'polyglots-stats.html'

export interface StatsOptions {
  out?: string
  // An ISO date. Anything else is refused rather than guessed at: quietly
  // falling back to "everything" would print a number covering a span the
  // caller did not ask for, and they would have no way to tell.
  since?: string
  jobsDb?: Database.Database
  now?: Date
}

export interface StatsSummary {
  file: string
  submissions: number
  entries: number
  incomplete: number
  translateRuns: number
  translateEntries: number
  flagged: number
  // Review entries per week, oldest first, for the terminal's sparkline.
  weeks: number[]
  topProjects: ProjectRow[]
}

function parseSince(since: string): number {
  const at = Date.parse(since)
  if (Number.isNaN(at)) {
    throw new Error(`--since ${JSON.stringify(since)} is not a date; use a form like 2026-09-01.`)
  }
  return at
}

/**
 * Renders the review history to a self-contained HTML page.
 *
 * Read-only against the job store: it never writes a row, so it is safe to run
 * while a review or translate is in flight.
 */
export async function writeStats(opts: StatsOptions = {}): Promise<StatsSummary> {
  const jobs = opts.jobsDb ?? openJobsDb()
  const ownsJobsDb = opts.jobsDb === undefined
  try {
    const window = opts.since === undefined ? {} : { since: parseSince(opts.since) }
    const stats = reviewStats(jobs, window)
    // Queried and rendered together, on one page, but never summed: a count of
    // "looks wrong" and a count of "wants a human eye" answer different
    // questions and their total answers neither.
    const translate = translateStats(jobs, window)
    const file = resolve(opts.out ?? DEFAULT_STATS_FILE)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, renderStats(stats, { translate, now: opts.now ?? new Date() }), 'utf8')
    return {
      file,
      submissions: stats.submissions,
      entries: stats.entries,
      incomplete: stats.incomplete,
      translateRuns: translate.runs,
      translateEntries: translate.entries,
      flagged: stats.flagged,
      // The terminal has room for a glance, not the page: twelve weeks is a
      // quarter, long enough to show a trend and short enough to fit any
      // width. byWeek is already oldest first.
      weeks: stats.byWeek.slice(-12).map((w) => w.entries),
      topProjects: [...stats.byProject]
        .sort((a, b) => b.entries - a.entries || a.project.localeCompare(b.project))
        .slice(0, 5),
    }
  } finally {
    if (ownsJobsDb) jobs.close()
  }
}
