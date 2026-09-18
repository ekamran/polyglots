import type Database from 'better-sqlite3'
import type { Locale } from '../types.js'
import type { Clock } from './verdicts.js'

// The first three mirror RunState in run-control.ts exactly, so the pause key
// needs no new vocabulary. `done` is the terminal state RunState has no need to
// name, because a finished run has no control left to exercise. `stopped` is
// also terminal, unlike `stopping`, which is a control state a run passes
// through on its way to either `stopped` or `done`.
export type RunRowState = 'running' | 'paused' | 'stopping' | 'done' | 'stopped'

export interface StartRunInput {
  file: string
  // The Project-Id-Version header. Captured because a reviewed file gets moved,
  // renamed or deleted, and its path stops being a reliable name for the work.
  project?: string
  command: 'review' | 'translate'
  locale: Locale
  nplurals: number
  batchSize: number
  engine: string
}

export interface RunTotals {
  entries: number
  flagged: number
  repaired: number
  unreviewed: number
  approvable: number
  byCategory: Record<string, number>
}

export interface RunRow extends StartRunInput {
  id: number
  state: RunRowState
  startedAt: number
  finishedAt?: number
  entries?: number
  flagged?: number
  repaired?: number
  unreviewed?: number
  approvable?: number
  byCategory?: Record<string, number>
}

export function startRun(db: Database.Database, input: StartRunInput, now: Clock = () => Date.now()): number {
  const result = db
    .prepare(
      `INSERT INTO run (file, project, command, locale, nplurals, batch_size, engine, state, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(
      input.file,
      input.project ?? null,
      input.command,
      input.locale,
      input.nplurals,
      input.batchSize,
      input.engine,
      now(),
    )
  return Number(result.lastInsertRowid)
}

// Scratch: what this run is working on and in what order, so progress and
// batching survive a restart. Replaced wholesale rather than merged, because a
// re-run over an edited file has a different entry list and a merge would leave
// rows for entries that no longer exist.
export function recordEntries(db: Database.Database, runId: number, keys: string[]): void {
  const write = db.transaction((): void => {
    db.prepare('DELETE FROM entry WHERE run_id = ?').run(runId)
    const insert = db.prepare('INSERT INTO entry (run_id, key, ord) VALUES (?, ?, ?)')
    for (const [ord, key] of keys.entries()) insert.run(runId, key, ord)
  })
  write()
}

export function setRunState(db: Database.Database, runId: number, state: RunRowState): void {
  db.prepare('UPDATE run SET state = ? WHERE id = ?').run(state, runId)
}

// Written once, from the same numbers the user was shown, and never
// recalculated. Not a denormalisation to be kept in sync with anything: a
// record of what was true at a moment, whose value comes precisely from not
// tracking later changes. The verdicts behind it are pruned whenever the
// glossary moves, so a live query would rewrite history.
export function finishRun(
  db: Database.Database,
  runId: number,
  totals: RunTotals,
  now: Clock = () => Date.now(),
): void {
  const write = db.transaction((): void => {
    db.prepare(
      `UPDATE run SET state = 'done', finished_at = ?, entries = ?, flagged = ?, repaired = ?,
         unreviewed = ?, approvable = ?, by_category = ? WHERE id = ?`,
    ).run(
      now(),
      totals.entries,
      totals.flagged,
      totals.repaired,
      totals.unreviewed,
      totals.approvable,
      JSON.stringify(totals.byCategory),
      runId,
    )
    db.prepare('DELETE FROM entry WHERE run_id = ?').run(runId)
  })
  write()
}

// A run that ended without finishing. Terminal, unlike `stopping`, which is a
// control state a run passes through. It freezes no totals — a run that did
// not look at every entry has no honest throughput or quality numbers to
// report — but it does drop the scratch rows, which nothing will ever read.
export function abandonRun(db: Database.Database, runId: number, now: Clock = () => Date.now()): void {
  const write = db.transaction((): void => {
    db.prepare(`UPDATE run SET state = 'stopped', finished_at = ? WHERE id = ?`).run(now(), runId)
    db.prepare('DELETE FROM entry WHERE run_id = ?').run(runId)
  })
  write()
}

interface Row {
  id: number
  file: string
  project: string | null
  command: string
  locale: string
  nplurals: number
  batch_size: number
  engine: string
  state: string
  started_at: number
  finished_at: number | null
  entries: number | null
  flagged: number | null
  repaired: number | null
  unreviewed: number | null
  approvable: number | null
  by_category: string | null
}

function tally(json: string | null): Record<string, number> | undefined {
  if (json === null) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, number>)
      : undefined
  } catch {
    return undefined
  }
}

function optional(value: number | null): number | undefined {
  return value === null ? undefined : value
}

export function getRun(db: Database.Database, runId: number): RunRow | undefined {
  const row = db.prepare<[number], Row>('SELECT * FROM run WHERE id = ?').get(runId)
  if (!row) return undefined
  const byCategory = tally(row.by_category)
  return {
    id: row.id,
    file: row.file,
    ...(row.project === null ? {} : { project: row.project }),
    command: row.command as 'review' | 'translate',
    locale: row.locale as Locale,
    nplurals: row.nplurals,
    batchSize: row.batch_size,
    engine: row.engine,
    state: row.state as RunRowState,
    startedAt: row.started_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(optional(row.entries) === undefined ? {} : { entries: row.entries! }),
    ...(optional(row.flagged) === undefined ? {} : { flagged: row.flagged! }),
    ...(optional(row.repaired) === undefined ? {} : { repaired: row.repaired! }),
    ...(optional(row.unreviewed) === undefined ? {} : { unreviewed: row.unreviewed! }),
    ...(optional(row.approvable) === undefined ? {} : { approvable: row.approvable! }),
    ...(byCategory === undefined ? {} : { byCategory }),
  }
}
