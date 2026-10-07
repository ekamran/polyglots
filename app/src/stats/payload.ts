import type Database from 'better-sqlite3'
import { RANGES, RANGE_DAYS, type Range, type StatsPayload } from './page/model.js'
import { reviewStats, translateStats } from './query.js'

const DAY = 86_400_000

export interface PayloadOptions {
  range: Range
  now: Date
  // A hard floor under every range: the CLI's --since. A range never reaches
  // past it, so "all" means "all since the floor".
  floor?: number
}

function since(range: Range, now: Date, floor: number | undefined): number | undefined {
  const start = range === 'all' ? undefined : now.getTime() - RANGE_DAYS[range] * DAY
  if (floor === undefined) return start
  return start === undefined ? floor : Math.max(start, floor)
}

/**
 * Everything one view of the page needs, queried fresh.
 *
 * Several queries over a table of a few thousand rows; better-sqlite3 answers
 * them in milliseconds, which is why the server runs this on every request
 * rather than caching. A cache would need invalidating when a review commits,
 * and getting that wrong shows stale numbers to someone watching a run land.
 */
export function buildPayload(db: Database.Database, opts: PayloadOptions): StatsPayload {
  const at = since(opts.range, opts.now, opts.floor)
  const window = at === undefined ? {} : { since: at }
  const lastYear = since('1y', opts.now, opts.floor)!
  const lastMonth = since('30d', opts.now, opts.floor)!
  const month = reviewStats(db, { since: lastMonth })
  return {
    range: opts.range,
    generatedAt: opts.now.getTime(),
    review: reviewStats(db, window),
    translate: translateStats(db, window),
    activity: reviewStats(db, { since: lastYear }).byDay,
    recent: {
      submissions: month.submissions,
      entries: month.entries,
      flagged: month.flagged,
      drafted: translateStats(db, { since: lastMonth }).entries,
    },
  }
}

/** Every range at once, for the standalone copy, which has no server to ask. */
export function buildPayloads(db: Database.Database, opts: Omit<PayloadOptions, 'range'>): Record<Range, StatsPayload> {
  return Object.fromEntries(RANGES.map((range) => [range, buildPayload(db, { ...opts, range })])) as Record<
    Range,
    StatsPayload
  >
}
