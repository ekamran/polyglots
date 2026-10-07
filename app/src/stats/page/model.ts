// The shape the stats page is drawn from, and the small pure helpers both
// sides need. Everything under page/ runs in Node (the server's first paint,
// the standalone copy, tests) and in the browser (the bundle), so nothing here
// may import a node: module or a database type at runtime.

import { findingLabel } from '../../rules/names.js'
import type { DayRow, ReviewStats, TranslateStats } from '../query.js'

export const RANGES = ['30d', '90d', '1y', 'all'] as const
export type Range = (typeof RANGES)[number]

export const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '30d': 30, '90d': 90, '1y': 365 }

/** A range from a query string, or all when it is missing or not one of ours. */
export function parseRange(value: string | null | undefined): Range {
  return (RANGES as readonly string[]).includes(value ?? '') ? (value as Range) : 'all'
}

/**
 * Local midnight of the first day the heatmap draws: the Monday 52 weeks
 * before the week containing `at`, so the grid is 53 whole weeks. That is up
 * to six days more than a year, and the payload's activity starts here too,
 * or the first column is drawn empty over days that had reviews.
 */
export function heatmapStart(at: number): number {
  const d = new Date(at)
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back - 52 * 7).getTime()
}

export interface Recent {
  submissions: number
  entries: number
  flagged: number
  drafted: number
}

export interface StatsPayload {
  range: Range
  generatedAt: number
  review: ReviewStats
  translate: TranslateStats
  // The last year of review days, whatever the range, so the heatmap always
  // shows a year: a 30-day heatmap is a strip, not a rhythm.
  activity: DayRow[]
  // The last thirty days, for the context line under each headline figure.
  recent: Recent
}

export interface FlagRow {
  key: string
  count: number
  // `other` is a key no current code writes: a rule since retired, still in
  // old rows. Shown under its key rather than dropped, so the legend still
  // adds up to the total it claims.
  source: 'rule' | 'ai' | 'process' | 'other'
}

const SOURCE_ORDER: Record<FlagRow['source'], number> = { rule: 0, ai: 1, process: 2, other: 3 }

/**
 * The run tally as legend rows: mechanical checks first, then the model's
 * findings, each by count. Grouped rather than interleaved because the two
 * deserve different trust, and a reader should see that split before any
 * single number.
 */
export function flagRows(byCategory: Record<string, number>): FlagRow[] {
  return Object.entries(byCategory)
    .filter(([, n]) => n > 0)
    .map(([key, count]): FlagRow => ({ key, count, source: findingLabel(key)?.source ?? 'other' }))
    .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || b.count - a.count || a.key.localeCompare(b.key))
}
