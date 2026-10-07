import { renderDocument } from './document.js'
import { BUILT_IN_LANGUAGES, ENGLISH, type StatsLanguage } from './i18n.js'
import type { Range, StatsPayload } from './page/model.js'
import type { ReviewStats, TranslateStats } from './query.js'

// The standalone copy of the stats page: one HTML file with the script, the
// style and the data inside, for mailing or archiving. It starts in English
// and on the widest range it carries; every language travels with it.

export interface StaticPageOptions {
  lang?: StatsLanguage
  languages?: readonly StatsLanguage[]
}

const isPayload = (value: unknown): value is StatsPayload =>
  typeof value === 'object' && value !== null && 'review' in value && 'range' in value

/**
 * A standalone page from one payload or several. The website's sample page
 * calls this with demoPayloads(); writeStats calls it with every range.
 */
export function renderStaticPage(
  payloads: StatsPayload | Partial<Record<Range, StatsPayload>>,
  opts: StaticPageOptions = {},
): string {
  const all: Partial<Record<Range, StatsPayload>> = isPayload(payloads) ? { [payloads.range]: payloads } : payloads
  const range = (['all', '1y', '90d', '30d'] as const).find((r) => all[r] !== undefined)
  if (range === undefined) throw new Error('renderStaticPage: no payload to render')
  return renderDocument({
    mode: 'static',
    range,
    payloads: all,
    lang: opts.lang ?? ENGLISH,
    languages: opts.languages ?? [ENGLISH, ...BUILT_IN_LANGUAGES],
  }).html
}

/** @deprecated The old entry, from totals alone. Kept for callers that have ReviewStats and nothing else. */
export interface RenderOptions {
  translate?: TranslateStats
  now?: Date
  // The languages besides English; the ones built from i18n/stats by default.
  languages?: readonly StatsLanguage[]
}

const DAY = 86_400_000

/**
 * @deprecated Use renderStaticPage with a payload. This builds a one-range
 * payload from the totals it is given, approximating the thirty-day context
 * lines from the daily rows.
 */
export function renderStats(stats: ReviewStats, options: RenderOptions = {}): string {
  const now = (options.now ?? new Date()).getTime()
  const empty: TranslateStats = {
    runs: 0,
    entries: 0,
    fuzzy: 0,
    fuzzyRate: 0,
    skipped: 0,
    incomplete: 0,
    running: 0,
    byWeek: [],
    byDay: [],
    turnaroundBuckets: stats.turnaroundBuckets.map(() => 0),
    byProject: [],
    byEngine: [],
  }
  const translate = options.translate ?? empty
  const monthAgo = new Date(now - 30 * DAY).toISOString().slice(0, 10)
  const recentDays = stats.byDay.filter((d) => d.day >= monthAgo)
  const payload: StatsPayload = {
    range: 'all',
    generatedAt: now,
    review: stats,
    translate,
    activity: stats.byDay,
    recent: {
      submissions: recentDays.reduce((n, d) => n + d.runs, 0),
      entries: recentDays.reduce((n, d) => n + d.entries, 0),
      flagged: 0,
      drafted: translate.byDay.filter((d) => d.day >= monthAgo).reduce((n, d) => n + d.entries, 0),
    },
  }
  return renderStaticPage(payload, {
    languages: [ENGLISH, ...(options.languages ?? BUILT_IN_LANGUAGES)],
  })
}
