import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import {
  abandonRun,
  finishRun,
  getRun,
  liveRuns,
  reapAbandonedRuns,
  recordEntries,
  startRun,
} from '../../src/jobs/runs.js'

let db: Database.Database
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-runs-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const input = {
  file: '/tmp/plugin-tr.po',
  project: 'Plugins - Thing - Stable',
  command: 'review' as const,
  locale: 'tr' as const,
  nplurals: 2,
  batchSize: 25,
  engine: 'claude',
}

describe('startRun', () => {
  it('records a running job and returns its id', () => {
    const id = startRun(db, input, () => 1000)
    const row = getRun(db, id)!
    expect(row.state).toBe('running')
    expect(row.file).toBe('/tmp/plugin-tr.po')
    expect(row.project).toBe('Plugins - Thing - Stable')
    expect(row.startedAt).toBe(1000)
    expect(row.finishedAt).toBeUndefined()
  })

  it('leaves the totals empty until the run finishes', () => {
    const row = getRun(db, startRun(db, input))!
    expect(row.entries).toBeUndefined()
    expect(row.flagged).toBeUndefined()
  })

  it('accepts a file with no Project-Id-Version header', () => {
    const { project, ...noProject } = input
    const row = getRun(db, startRun(db, noProject))!
    expect(row.project).toBeUndefined()
  })
})

describe('recordEntries', () => {
  it('keeps the order the entries were given in, so batching is reproducible', () => {
    const id = startRun(db, input)
    recordEntries(db, id, ['b', 'a', 'c'])
    const rows = db
      .prepare<[number], { key: string; ord: number }>('SELECT key, ord FROM entry WHERE run_id = ? ORDER BY ord')
      .all(id)
    expect(rows.map((r) => r.key)).toEqual(['b', 'a', 'c'])
  })

  it('replaces the previous list rather than appending to it', () => {
    const id = startRun(db, input)
    recordEntries(db, id, ['a', 'b'])
    recordEntries(db, id, ['a'])
    const n = db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM entry WHERE run_id = ?').get(id)!.n
    expect(n).toBe(1)
  })
})

describe('finishRun', () => {
  const totals = {
    entries: 294,
    flagged: 108,
    repaired: 108,
    unreviewed: 0,
    approvable: 186,
    byCategory: { 'title-case': 80, glossary: 39 },
  }

  it('freezes the totals and marks the run done', () => {
    const id = startRun(db, input, () => 1000)
    finishRun(db, id, totals, () => 5000)
    const row = getRun(db, id)!
    expect(row.state).toBe('done')
    expect(row.finishedAt).toBe(5000)
    expect(row.entries).toBe(294)
    expect(row.flagged).toBe(108)
    expect(row.approvable).toBe(186)
    expect(row.byCategory).toEqual({ 'title-case': 80, glossary: 39 })
  })

  it('survives the verdicts behind it being deleted', () => {
    // The whole point of freezing: a glossary edit prunes every verdict, and
    // last year's numbers must not move because of it.
    const id = startRun(db, input)
    finishRun(db, id, totals)
    db.prepare('DELETE FROM audit_verdict').run()
    expect(getRun(db, id)!.flagged).toBe(108)
  })

  it('drops the scratch entry rows, which are worthless once the run is done', () => {
    const id = startRun(db, input)
    recordEntries(db, id, ['a', 'b'])
    finishRun(db, id, totals)
    const n = db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM entry WHERE run_id = ?').get(id)!.n
    expect(n).toBe(0)
  })
})

describe('getRun reading a row back', () => {
  const totals = {
    entries: 294,
    flagged: 0,
    repaired: 0,
    unreviewed: 0,
    approvable: 294,
    byCategory: { 'title-case': 3 },
  }

  it('reads a legitimate zero as zero, not as an absent snapshot', () => {
    // A review that finished and flagged nothing is the best possible result.
    // Reported as "no snapshot" it would look like a run that never completed.
    const id = startRun(db, input)
    finishRun(db, id, totals)
    const row = getRun(db, id)!
    expect(row.flagged).toBe(0)
    expect(row.repaired).toBe(0)
    expect(row.unreviewed).toBe(0)
  })

  it('reads an unparseable by_category as absent rather than throwing', () => {
    const id = startRun(db, input)
    finishRun(db, id, totals)
    db.prepare('UPDATE run SET by_category = ? WHERE id = ?').run('{not json', id)
    expect(() => getRun(db, id)).not.toThrow()
    expect(getRun(db, id)!.byCategory).toBeUndefined()
  })

  it('reads a by_category holding a non-number as absent, not as a partial tally', () => {
    // A chart built from a tally with one entry silently dropped is worse than
    // one that admits it has nothing to draw.
    const id = startRun(db, input)
    finishRun(db, id, totals)
    db.prepare('UPDATE run SET by_category = ? WHERE id = ?').run('{"title-case":"lots"}', id)
    expect(getRun(db, id)!.byCategory).toBeUndefined()
  })

  it('reads a by_category holding an array as absent', () => {
    const id = startRun(db, input)
    finishRun(db, id, totals)
    db.prepare('UPDATE run SET by_category = ? WHERE id = ?').run('[1,2,3]', id)
    expect(getRun(db, id)!.byCategory).toBeUndefined()
  })
})

describe('abandonRun', () => {
  it('marks a run stopped, with no totals to report', () => {
    const id = startRun(db, input, () => 1000)
    abandonRun(db, id, () => 5000)
    const row = getRun(db, id)!
    expect(row.state).toBe('stopped')
    expect(row.finishedAt).toBe(5000)
    // Statistics are only honest for a run that looked at every entry.
    expect(row.entries).toBeUndefined()
    expect(row.flagged).toBeUndefined()
    expect(row.approvable).toBeUndefined()
  })

  it('drops the scratch entry rows, which nothing will ever read once abandoned', () => {
    const id = startRun(db, input)
    recordEntries(db, id, ['a', 'b'])
    abandonRun(db, id)
    const n = db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM entry WHERE run_id = ?').get(id)!.n
    expect(n).toBe(0)
  })
})

describe('liveRuns', () => {
  it('finds a run this process started', () => {
    startRun(db, input)
    expect(liveRuns(db).map((r) => r.command)).toEqual(['review'])
  })

  it('ignores a finished run', () => {
    const id = startRun(db, input)
    finishRun(db, id, { entries: 1, flagged: 0, repaired: 0, unreviewed: 0, approvable: 1, byCategory: {} })
    expect(liveRuns(db)).toEqual([])
  })

  it('ignores an abandoned run', () => {
    abandonRun(db, startRun(db, input))
    expect(liveRuns(db)).toEqual([])
  })

  it('ignores a row left running by a process that is gone', () => {
    // A hard kill leaves state='running' forever. Without the pid check that
    // row would block every later build, which is worse than the hazard the
    // check exists to prevent.
    const id = startRun(db, input)
    db.prepare('UPDATE run SET pid = ? WHERE id = ?').run(999_999, id)
    expect(liveRuns(db)).toEqual([])
  })

  it('reports enough to name what is running', () => {
    startRun(db, input)
    const [run] = liveRuns(db)
    expect(run).toMatchObject({ command: 'review', file: '/tmp/plugin-tr.po' })
    expect(run!.pid).toBe(process.pid)
  })

  it('treats a row with no pid as not live, since it predates the column', () => {
    const id = startRun(db, input)
    db.prepare('UPDATE run SET pid = NULL WHERE id = ?').run(id)
    expect(liveRuns(db)).toEqual([])
  })
})

describe('reapAbandonedRuns', () => {
  const dead = (id: number) => db.prepare('UPDATE run SET pid = ? WHERE id = ?').run(999_999, id)

  it('marks a row whose process is gone as stopped', () => {
    const id = startRun(db, input)
    dead(id)
    expect(reapAbandonedRuns(db, () => 5000)).toBe(1)
    const row = getRun(db, id)!
    expect(row.state).toBe('stopped')
    expect(row.finishedAt).toBe(5000)
  })

  it('drops the scratch entry rows the abandoned run left behind', () => {
    const id = startRun(db, input)
    recordEntries(db, id, ['a', 'b', 'c'])
    dead(id)
    reapAbandonedRuns(db)
    expect(db.prepare('SELECT count(*) n FROM entry WHERE run_id = ?').get(id)).toEqual({ n: 0 })
  })

  it('reaps a row with no pid, which predates the column', () => {
    // This is the row the live database actually has: killed before 0.7.1 added
    // the pid, so there is nothing to check it against and it can never clear
    // itself. liveRuns already calls it not live; the two must agree.
    const id = startRun(db, input)
    db.prepare('UPDATE run SET pid = NULL WHERE id = ?').run(id)
    expect(reapAbandonedRuns(db)).toBe(1)
    expect(getRun(db, id)!.state).toBe('stopped')
  })

  it('leaves a genuinely running job alone', () => {
    // The whole risk of a reaper: killing the bookkeeping of a run still in
    // flight. This process is alive by definition, so its row must survive.
    const id = startRun(db, input)
    recordEntries(db, id, ['a', 'b'])
    expect(reapAbandonedRuns(db)).toBe(0)
    expect(getRun(db, id)!.state).toBe('running')
    expect(db.prepare('SELECT count(*) n FROM entry WHERE run_id = ?').get(id)).toEqual({ n: 2 })
  })

  it('reaps the dead row and spares the live one in the same pass', () => {
    const live = startRun(db, input)
    const gone = startRun(db, input)
    dead(gone)
    expect(reapAbandonedRuns(db)).toBe(1)
    expect(getRun(db, live)!.state).toBe('running')
    expect(getRun(db, gone)!.state).toBe('stopped')
  })

  it('does not touch a finished run', () => {
    const id = startRun(db, input)
    finishRun(db, id, { entries: 9, flagged: 1, repaired: 0, unreviewed: 0, approvable: 8, byCategory: {} })
    expect(reapAbandonedRuns(db)).toBe(0)
    expect(getRun(db, id)!.state).toBe('done')
    // finishRun froze these totals. A reaper that rewrote finished_at would
    // corrupt the one record stats reads as history.
    expect(getRun(db, id)!.entries).toBe(9)
  })

  it('does not touch an already-stopped run', () => {
    const id = startRun(db, input)
    abandonRun(db, id, () => 100)
    expect(reapAbandonedRuns(db, () => 200)).toBe(0)
    expect(getRun(db, id)!.finishedAt).toBe(100)
  })

  it('claims no totals for the run it reaps', () => {
    // An abandoned run did not look at every entry, so it has no honest
    // throughput to report. Same reasoning as abandonRun.
    const id = startRun(db, input)
    dead(id)
    reapAbandonedRuns(db)
    const row = getRun(db, id)!
    expect(row.entries).toBeUndefined()
    expect(row.flagged).toBeUndefined()
  })

  it('is idempotent', () => {
    const id = startRun(db, input)
    dead(id)
    expect(reapAbandonedRuns(db)).toBe(1)
    expect(reapAbandonedRuns(db)).toBe(0)
  })

  it('agrees with liveRuns about what is live', () => {
    // Two notions of "live" that can drift is the defect this guards against:
    // the reaper would stop a run the build guard still protects.
    const live = startRun(db, input)
    const gone = startRun(db, input)
    dead(gone)
    const liveIds = liveRuns(db).map((r) => r.id)
    reapAbandonedRuns(db)
    const stillRunning = db.prepare(`SELECT id FROM run WHERE state = 'running'`).all() as Array<{ id: number }>
    expect(stillRunning.map((r) => r.id)).toEqual(liveIds)
    expect(liveIds).toEqual([live])
    expect(gone).not.toBe(live)
  })
})
