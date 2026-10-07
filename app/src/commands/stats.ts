import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../jobs/index.js'
import { buildPayloads } from '../stats/payload.js'
import { reviewStats, translateStats, type ProjectRow } from '../stats/query.js'
import { renderStaticPage } from '../stats/render.js'
import { openInBrowser, startStatsServer, type StatsServer } from '../stats/server.js'

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

/** The terminal's summary of the job store, without writing or serving anything. */
export function summarizeStats(jobs: Database.Database, opts: { since?: number }): Omit<StatsSummary, 'file'> {
  const window = opts.since === undefined ? {} : { since: opts.since }
  const stats = reviewStats(jobs, window)
  // Queried together but never summed: a count of "looks wrong" and a count
  // of "wants a human eye" answer different questions and their total
  // answers neither.
  const translate = translateStats(jobs, window)
  return {
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
}

/**
 * Writes the standalone copy of the stats page: script, style and every
 * range's data inside one file, for mailing or archiving.
 *
 * Read-only against the job store: it never writes a row, so it is safe to run
 * while a review or translate is in flight.
 */
export async function writeStats(opts: StatsOptions = {}): Promise<StatsSummary> {
  const jobs = opts.jobsDb ?? openJobsDb()
  const ownsJobsDb = opts.jobsDb === undefined
  try {
    const floor = opts.since === undefined ? undefined : parseSince(opts.since)
    const now = opts.now ?? new Date()
    const payloads = buildPayloads(jobs, { now, ...(floor === undefined ? {} : { floor }) })
    const file = resolve(opts.out ?? DEFAULT_STATS_FILE)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, renderStaticPage(payloads), 'utf8')
    return { file, ...summarizeStats(jobs, floor === undefined ? {} : { since: floor }) }
  } finally {
    if (ownsJobsDb) jobs.close()
  }
}

export interface ServeOptions {
  since?: string
  // Open the default browser. On by default; --no-open turns it off.
  open?: boolean
  jobsDb?: Database.Database
  now?: () => Date
  // Errors the server meets after it started. The CLI writes them to stderr;
  // without that a failed request leaves nothing but a 500 in the browser.
  onError?: (err: Error) => void
  // Seams for tests. The defaults are the real server, the real opener, and
  // the first SIGINT or SIGTERM.
  start?: typeof startStatsServer
  openBrowser?: (url: string) => Promise<boolean>
  untilStopped?: () => Promise<void>
}

export interface Serving {
  url: string
  opened: boolean
  summary: Omit<StatsSummary, 'file'>
}

// Ctrl+C would otherwise kill the process outright, leaving the job store
// open and the browser's sockets to time out. Listening turns it into an
// orderly stop; the listeners go once it fires, so a second Ctrl+C during a
// slow close still kills.
function untilSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

/**
 * Serves the stats page until stopped. `onReady` hears the URL and the summary
 * once the server is listening, so the caller can print them; the promise
 * resolves after the server has closed.
 */
export async function serveStats(opts: ServeOptions, onReady: (serving: Serving) => void): Promise<void> {
  const floor = opts.since === undefined ? undefined : parseSince(opts.since)
  const jobs = opts.jobsDb ?? openJobsDb()
  const ownsJobsDb = opts.jobsDb === undefined
  let server: StatsServer | undefined
  try {
    server = await (opts.start ?? startStatsServer)({
      jobsDb: jobs,
      ...(floor === undefined ? {} : { since: floor }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
      ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    })
    const opened = opts.open === false ? false : await (opts.openBrowser ?? openInBrowser)(server.url)
    onReady({ url: server.url, opened, summary: summarizeStats(jobs, floor === undefined ? {} : { since: floor }) })
    await (opts.untilStopped ?? untilSignal)()
  } finally {
    await server?.close()
    if (ownsJobsDb) jobs.close()
  }
}
