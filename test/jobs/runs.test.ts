import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { abandonRun, finishRun, getRun, recordEntries, startRun } from '../../src/jobs/runs.js'

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
