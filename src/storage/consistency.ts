import type Database from 'better-sqlite3'
import type { ConsistencyEntry, ConsistencyScope, Locale } from '../types.js'

export type Clock = () => Date

const DAY_MS = 86_400_000

export function getConsistency(
  db: Database.Database,
  text: string,
  locale: Locale,
  ttlDays: number,
  scope: ConsistencyScope = 'core',
  now: Clock = () => new Date(),
): ConsistencyEntry[] | undefined {
  const row = db
    .prepare<[string, string, string], { results_json: string; fetched_at: string }>(
      'SELECT results_json, fetched_at FROM consistency_cache WHERE source_text = ? AND locale = ? AND scope = ?',
    )
    .get(text, locale, scope)
  if (!row) return undefined
  const fetchedAt = Date.parse(row.fetched_at)
  if (Number.isNaN(fetchedAt) || now().getTime() - fetchedAt > ttlDays * DAY_MS) return undefined
  try {
    return JSON.parse(row.results_json) as ConsistencyEntry[]
  } catch {
    return undefined
  }
}

export function setConsistency(
  db: Database.Database,
  text: string,
  locale: Locale,
  entries: ConsistencyEntry[],
  scope: ConsistencyScope = 'core',
  now: Clock = () => new Date(),
): void {
  db.prepare(
    `INSERT INTO consistency_cache (source_text, locale, scope, results_json, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source_text, locale, scope) DO UPDATE SET
       results_json = excluded.results_json,
       fetched_at = excluded.fetched_at`,
  ).run(text, locale, scope, JSON.stringify(entries), now().toISOString())
}
