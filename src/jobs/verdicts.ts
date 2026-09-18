import type Database from 'better-sqlite3'
import { AUDIT_CATEGORIES, type AuditCategory } from '../audit/schema.js'
import type { Locale } from '../types.js'
import { parseStringArray, type Clock } from './json.js'

export interface VerdictKey {
  srcHash: string
  configHash: string
  locale: Locale
  engine: string
}

// The model's own output, and only that. The rule findings that accompany a
// verdict are recomputed on every pass and never stored, so what comes back
// from here is fed through the same toVerdict() a fresh result would be.
export interface CachedVerdict {
  problem: boolean
  // The same narrow union the model's schema enforces, not bare strings. A
  // stored category is re-validated on the way out rather than trusted: these
  // become `ai:<category>` findings that are written into the reviewer's output
  // file, so a row left behind by an older build must not smuggle a category
  // this one does not understand into a submission.
  categories: AuditCategory[]
  reason: string
  fix?: string[]
}

interface Row {
  problem: number
  reason: string
  categories: string
  fix: string | null
}

const isCategory = (value: string): value is AuditCategory =>
  (AUDIT_CATEGORIES as readonly string[]).includes(value)

// filter with a type guard narrows; comparing the lengths is what turns
// "some were unrecognised" into a miss rather than a quietly shortened list.
function parseCategories(json: string): AuditCategory[] | undefined {
  const all = parseStringArray(json)
  if (!all) return undefined
  const known = all.filter(isCategory)
  return known.length === all.length ? known : undefined
}

export function getAuditVerdict(db: Database.Database, key: VerdictKey): CachedVerdict | undefined {
  const row = db
    .prepare<[string, string, string, string], Row>(
      `SELECT problem, reason, categories, fix FROM audit_verdict
       WHERE src_hash = ? AND config_hash = ? AND locale = ? AND engine = ?`,
    )
    .get(key.srcHash, key.configHash, key.locale, key.engine)
  if (!row) return undefined
  // A hand-edited or truncated row reads as a miss, not as a degraded hit.
  // Substituting an empty array for unreadable categories would hand back a
  // verdict that looks intact but has lost the findings it was built from, and
  // the caller would trust it rather than re-ask. The cache is disposable, so
  // re-asking the model is always a correct answer; returning a wrong verdict
  // never is.
  //
  // A null `fix` is not corruption: a cleared entry legitimately has no repair,
  // and must still read as a hit.
  const categories = parseCategories(row.categories)
  if (!categories) return undefined
  let fix: string[] | undefined
  if (row.fix !== null) {
    fix = parseStringArray(row.fix)
    if (!fix) return undefined
  }

  return {
    problem: row.problem === 1,
    categories,
    reason: row.reason,
    ...(fix && fix.length > 0 ? { fix } : {}),
  }
}

export function putAuditVerdict(
  db: Database.Database,
  key: VerdictKey,
  verdict: CachedVerdict,
  now: Clock = () => Date.now(),
): void {
  db.prepare(
    `INSERT INTO audit_verdict (src_hash, config_hash, locale, engine, problem, reason, categories, fix, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (src_hash, config_hash, locale, engine) DO UPDATE SET
       problem = excluded.problem,
       reason = excluded.reason,
       categories = excluded.categories,
       fix = excluded.fix,
       at = excluded.at`,
  ).run(
    key.srcHash,
    key.configHash,
    key.locale,
    key.engine,
    verdict.problem ? 1 : 0,
    verdict.reason,
    JSON.stringify(verdict.categories),
    verdict.fix ? JSON.stringify(verdict.fix) : null,
    now(),
  )
}

export type CachedTable = 'audit_verdict' | 'draft_verdict'

// The cache holds verdicts for the current configuration and nothing else.
//
// One table at a time, because review and translate compute different
// configuration hashes: review's covers the glossary and the rules, translate's
// covers only its own prompt. Pruning both from one call would mean running
// translate deleted every review verdict, and vice versa.
//
// The locale predicate is load-bearing too: the glossary is per locale, so
// config_hash differs per locale, and without it reviewing a `de` submission
// would delete every `tr` verdict and reviewing a `tr` one would delete them
// straight back. `table` is a closed union, never interpolated user input.
export function pruneStaleConfigs(
  db: Database.Database,
  table: CachedTable,
  locale: Locale,
  configHash: string,
): number {
  return db.prepare(`DELETE FROM ${table} WHERE locale = ? AND config_hash <> ?`).run(locale, configHash).changes
}
