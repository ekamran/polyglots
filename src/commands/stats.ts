import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../jobs/index.js'
import { reviewStats } from '../stats/query.js'
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
    const stats = reviewStats(jobs, opts.since === undefined ? {} : { since: parseSince(opts.since) })
    const file = resolve(opts.out ?? DEFAULT_STATS_FILE)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, renderStats(stats, opts.now ?? new Date()), 'utf8')
    return {
      file,
      submissions: stats.submissions,
      entries: stats.entries,
      incomplete: stats.incomplete,
    }
  } finally {
    if (ownsJobsDb) jobs.close()
  }
}
