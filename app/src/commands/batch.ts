import type Database from 'better-sqlite3'
import { openJobsDb } from '../jobs/db.js'
import { createRunControl, type RunControl } from '../run-control.js'
import { openDb } from '../storage/index.js'

/**
 * The most jobs a batch runs at once.
 *
 * Five parallel reviews have been run by hand without trouble. Eight leaves
 * room above that while staying well under the point where provider rate
 * limits, not this machine, decide how fast a batch goes, and where one
 * failure turns into eight retries at the same moment.
 */
export const MAX_PARALLEL = 8

export type ProjectOutcome<T> =
  | { file: string; state: 'done'; summary: T }
  | { file: string; state: 'failed'; reason: string }
  | { file: string; state: 'stopped' }

export type ProjectEvent<T> =
  | { type: 'project-start'; file: string }
  | { type: 'project-end'; outcome: ProjectOutcome<T> }

/**
 * Runs one job per file, at most `parallel` at a time, and reports how each
 * one ended.
 *
 * One failure never stops the batch. A batch of thirty projects is started and
 * left alone, and finding out at the end that the second one hit a parse error
 * and the other twenty-eight never ran would cost an evening. The failure is
 * reported in its place and the rest carry on.
 *
 * Every job is handed the same control, so one key stops or pauses the whole
 * batch. The pool also waits at that control before starting each job: running
 * jobs stop or park at their own batch boundary, and the pool must not start a
 * fresh one behind them. Jobs that never started when a stop arrived are
 * reported as stopped, not failed, since stopping part way is ordinary use and
 * their work is still to do.
 *
 * Outcomes come back in input order rather than finish order, so the table the
 * person reads lines up with the list they pasted.
 */
export async function runProjects<T>(
  files: string[],
  opts: {
    parallel: number
    run: (file: string, control: RunControl) => Promise<T>
    control?: RunControl
    onEvent?: (e: ProjectEvent<T>) => void
  },
): Promise<ProjectOutcome<T>[]> {
  const control = opts.control ?? createRunControl()
  const width = Math.min(MAX_PARALLEL, Math.max(1, Math.floor(opts.parallel) || 1))
  const outcomes: ProjectOutcome<T>[] = new Array(files.length)
  let next = 0

  const end = (i: number, outcome: ProjectOutcome<T>) => {
    outcomes[i] = outcome
    opts.onEvent?.({ type: 'project-end', outcome })
  }

  const worker = async () => {
    while (next < files.length) {
      // Claimed before the gate so two workers never take the same file while
      // both are parked on a pause.
      const i = next++
      const file = files[i]!
      if ((await control.gate()) === 'stop') {
        end(i, { file, state: 'stopped' })
        continue
      }
      opts.onEvent?.({ type: 'project-start', file })
      try {
        end(i, { file, state: 'done', summary: await opts.run(file, control) })
      } catch (err) {
        end(i, { file, state: 'failed', reason: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, files.length) }, worker))
  return outcomes
}

/**
 * Opens both databases once for a batch and closes them when it settles.
 *
 * Every job in a batch gets these same handles. Each opening its own would put
 * several connections on one WAL file from one process for no gain, and since
 * better-sqlite3 is synchronous, jobs sharing a handle cannot interleave a
 * write. The CLI and the menu both run batches, so both open them here.
 */
export async function withSharedDbs<T>(
  fn: (dbs: { db: Database.Database; jobsDb: Database.Database }) => Promise<T>,
): Promise<T> {
  const db = openDb()
  try {
    const jobsDb = openJobsDb()
    try {
      return await fn({ db, jobsDb })
    } finally {
      jobsDb.close()
    }
  } finally {
    db.close()
  }
}
