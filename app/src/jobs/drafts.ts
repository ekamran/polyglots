import type Database from 'better-sqlite3'
import type { Locale } from '../types.js'
import { parseStringArray, type Clock } from './json.js'

export interface DraftKey {
  srcHash: string
  // The draft engine's prompt. A draft is written straight into the user's .po,
  // so it must not outlive the instructions it was written under: without this
  // the row would be immortal, matched forever and never pruned.
  configHash: string
  locale: Locale
  engine: string
}

// The review pass judges the draft, so a resumed translate that re-drafted
// would be asking a different question and would never hit this cache. Caching
// the draft as well is what makes translate resumable at all, and it also
// stops a resumed run re-paying the metered draft API.
//
// `configHash` means something different on each of these: the draft's is the
// draft engine's prompt, the verdict's is the review prompt. They are pruned
// separately for that reason.
export interface DraftVerdictKey extends DraftKey {
  draftHash: string
}

export interface DraftReview {
  text: string[]
  fuzzy: boolean
  reason: string
}

export function getDraft(db: Database.Database, key: DraftKey): string[] | undefined {
  const row = db
    .prepare<[string, string, string, string], { text: string }>(
      'SELECT text FROM draft WHERE src_hash = ? AND config_hash = ? AND locale = ? AND engine = ?',
    )
    .get(key.srcHash, key.configHash, key.locale, key.engine)
  return row ? parseStringArray(row.text) : undefined
}

export function putDraft(
  db: Database.Database,
  key: DraftKey,
  text: string[],
  now: Clock = () => Date.now(),
): void {
  db.prepare(
    `INSERT INTO draft (src_hash, config_hash, locale, engine, text, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (src_hash, config_hash, locale, engine) DO UPDATE SET text = excluded.text, at = excluded.at`,
  ).run(key.srcHash, key.configHash, key.locale, key.engine, JSON.stringify(text), now())
}

export function getDraftVerdict(db: Database.Database, key: DraftVerdictKey): DraftReview | undefined {
  const row = db
    .prepare<[string, string, string, string, string], { text: string; fuzzy: number; reason: string }>(
      `SELECT text, fuzzy, reason FROM draft_verdict
       WHERE src_hash = ? AND draft_hash = ? AND config_hash = ? AND locale = ? AND engine = ?`,
    )
    .get(key.srcHash, key.draftHash, key.configHash, key.locale, key.engine)
  if (!row) return undefined
  const text = parseStringArray(row.text)
  return text ? { text, fuzzy: row.fuzzy === 1, reason: row.reason } : undefined
}

export function putDraftVerdict(
  db: Database.Database,
  key: DraftVerdictKey,
  review: DraftReview,
  now: Clock = () => Date.now(),
): void {
  db.prepare(
    `INSERT INTO draft_verdict (src_hash, draft_hash, config_hash, locale, engine, text, fuzzy, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (src_hash, draft_hash, config_hash, locale, engine) DO UPDATE SET
       text = excluded.text, fuzzy = excluded.fuzzy, reason = excluded.reason, at = excluded.at`,
  ).run(
    key.srcHash,
    key.draftHash,
    key.configHash,
    key.locale,
    key.engine,
    JSON.stringify(review.text),
    review.fuzzy ? 1 : 0,
    review.reason,
    now(),
  )
}
