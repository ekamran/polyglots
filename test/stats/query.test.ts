import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { abandonRun, finishRun, startRun } from '../../src/jobs/runs.js'
import { reviewStats } from '../../src/stats/query.js'

let db: Database.Database
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-stats-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const DAY = 86_400_000
// A Monday, so a test can reason about which week a run lands in.
const MONDAY = Date.UTC(2026, 8, 7)

interface Reviewed {
  project?: string
  file?: string
  startedAt: number
  tookMs: number
  entries: number
  flagged: number
  repaired?: number
  approvable?: number
  byCategory?: Record<string, number>
}

function reviewed(over: Reviewed): void {
  const id = startRun(
    db,
    {
      file: over.file ?? '/tmp/plugin-tr.po',
      ...(over.project ? { project: over.project } : {}),
      command: 'review',
      locale: 'tr',
      nplurals: 2,
      batchSize: 25,
      engine: 'claude',
    },
    () => over.startedAt,
  )
  finishRun(
    db,
    id,
    {
      entries: over.entries,
      flagged: over.flagged,
      repaired: over.repaired ?? over.flagged,
      unreviewed: 0,
      approvable: over.approvable ?? over.entries - over.flagged,
      byCategory: over.byCategory ?? {},
    },
    () => over.startedAt + over.tookMs,
  )
}

describe('reviewStats with nothing recorded', () => {
  it('reports zeroes rather than throwing', () => {
    const s = reviewStats(db)
    expect(s.submissions).toBe(0)
    expect(s.entries).toBe(0)
  })

  it('reports a problem rate of zero rather than dividing by zero', () => {
    // NaN would reach the rendered page and read as a broken report.
    expect(reviewStats(db).problemRate).toBe(0)
  })

  it('has no turnaround to report', () => {
    expect(reviewStats(db).medianTurnaroundMs).toBeUndefined()
  })
})

describe('reviewStats headline counts', () => {
  it('counts finished reviews and sums what they found', () => {
    reviewed({ startedAt: MONDAY, tookMs: DAY / 24, entries: 100, flagged: 40 })
    reviewed({ startedAt: MONDAY + DAY, tookMs: DAY / 24, entries: 200, flagged: 20 })
    const s = reviewStats(db)
    expect(s.submissions).toBe(2)
    expect(s.entries).toBe(300)
    expect(s.flagged).toBe(60)
  })

  it('reports the problem rate over entries, not over submissions', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 100, flagged: 40 })
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 300, flagged: 0 })
    // 40 of 400, not the mean of 40% and 0%.
    expect(reviewStats(db).problemRate).toBeCloseTo(0.1, 5)
  })

  it('ignores translate runs, which measure different work', () => {
    const id = startRun(
      db,
      { file: '/tmp/t.po', command: 'translate', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'deepl' },
      () => MONDAY,
    )
    finishRun(db, id, { entries: 999, flagged: 9, repaired: 0, unreviewed: 0, approvable: 0, byCategory: {} })
    expect(reviewStats(db).submissions).toBe(0)
    expect(reviewStats(db).entries).toBe(0)
  })
})

describe('reviewStats and runs that never finished', () => {
  it('leaves an abandoned run out of the totals, because it froze none', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 100, flagged: 40 })
    const id = startRun(
      db,
      { file: '/tmp/x.po', command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
      () => MONDAY,
    )
    abandonRun(db, id)
    expect(reviewStats(db).entries).toBe(100)
  })

  it('counts them separately, so the page can say they happened', () => {
    // Silently dropping failures is the same class of lie as a count that
    // disagrees with the file it describes.
    const id = startRun(
      db,
      { file: '/tmp/x.po', command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
      () => MONDAY,
    )
    abandonRun(db, id)
    expect(reviewStats(db).incomplete).toBe(1)
  })

  it('does not count a translate run that was abandoned', () => {
    const id = startRun(
      db,
      { file: '/tmp/t.po', command: 'translate', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'deepl' },
      () => MONDAY,
    )
    abandonRun(db, id)
    expect(reviewStats(db).incomplete).toBe(0)
  })
})

describe('reviewStats turnaround', () => {
  it('takes the middle value of an odd number of runs', () => {
    for (const ms of [1000, 5000, 3000]) reviewed({ startedAt: MONDAY, tookMs: ms, entries: 1, flagged: 0 })
    expect(reviewStats(db).medianTurnaroundMs).toBe(3000)
  })

  it('averages the middle two of an even number', () => {
    for (const ms of [1000, 2000, 4000, 6000]) reviewed({ startedAt: MONDAY, tookMs: ms, entries: 1, flagged: 0 })
    expect(reviewStats(db).medianTurnaroundMs).toBe(3000)
  })

  it('uses the median rather than the mean, so one overnight run does not swamp it', () => {
    for (const ms of [1000, 1000, 1000, 1000, 100_000_000]) {
      reviewed({ startedAt: MONDAY, tookMs: ms, entries: 1, flagged: 0 })
    }
    expect(reviewStats(db).medianTurnaroundMs).toBe(1000)
  })
})

describe('reviewStats by category', () => {
  it('adds up the frozen tallies across runs', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 10, flagged: 5, byCategory: { 'title-case': 3, glossary: 2 } })
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 10, flagged: 4, byCategory: { 'title-case': 4 } })
    expect(reviewStats(db).byCategory).toEqual({ 'title-case': 7, glossary: 2 })
  })

  it('orders categories by how often they fire, because that is the story', () => {
    reviewed({
      startedAt: MONDAY,
      tookMs: 1,
      entries: 10,
      flagged: 6,
      byCategory: { glossary: 1, 'title-case': 5, placeholder: 3 },
    })
    expect(Object.keys(reviewStats(db).byCategory)).toEqual(['title-case', 'placeholder', 'glossary'])
  })
})

describe('reviewStats by week', () => {
  it('buckets runs into the week they started', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 10, flagged: 0 })
    reviewed({ startedAt: MONDAY + 2 * DAY, tookMs: 1, entries: 5, flagged: 0 })
    reviewed({ startedAt: MONDAY + 7 * DAY, tookMs: 1, entries: 7, flagged: 0 })
    const weeks = reviewStats(db).byWeek
    expect(weeks).toHaveLength(2)
    expect(weeks[0]).toMatchObject({ entries: 15 })
    expect(weeks[1]).toMatchObject({ entries: 7 })
  })

  it('names each bucket by the Monday it starts on', () => {
    reviewed({ startedAt: MONDAY + 3 * DAY, tookMs: 1, entries: 1, flagged: 0 })
    expect(reviewStats(db).byWeek[0]!.week).toBe('2026-09-07')
  })

  it('returns weeks oldest first, so a chart reads left to right', () => {
    reviewed({ startedAt: MONDAY + 7 * DAY, tookMs: 1, entries: 1, flagged: 0 })
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 1, flagged: 0 })
    expect(reviewStats(db).byWeek.map((w) => w.week)).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('leaves a quiet week out rather than inventing a zero', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 1, flagged: 0 })
    reviewed({ startedAt: MONDAY + 14 * DAY, tookMs: 1, entries: 1, flagged: 0 })
    expect(reviewStats(db).byWeek).toHaveLength(2)
  })
})

describe('reviewStats by project', () => {
  it('groups by the project name the file declared', () => {
    reviewed({ project: 'Plugins - Alpha', startedAt: MONDAY, tookMs: 1, entries: 10, flagged: 2 })
    reviewed({ project: 'Plugins - Alpha', startedAt: MONDAY, tookMs: 1, entries: 20, flagged: 3 })
    reviewed({ project: 'Plugins - Beta', startedAt: MONDAY, tookMs: 1, entries: 5, flagged: 0 })
    const rows = reviewStats(db).byProject
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ project: 'Plugins - Alpha', submissions: 2, entries: 30, flagged: 5 })
  })

  it('falls back to the file name when the .po declared no project', () => {
    reviewed({ file: '/tmp/wp-plugins-thing-tr.po', startedAt: MONDAY, tookMs: 1, entries: 3, flagged: 1 })
    expect(reviewStats(db).byProject[0]!.project).toBe('wp-plugins-thing-tr.po')
  })

  it('orders by entries, so the biggest piece of work is first', () => {
    reviewed({ project: 'Small', startedAt: MONDAY, tookMs: 1, entries: 5, flagged: 0 })
    reviewed({ project: 'Large', startedAt: MONDAY, tookMs: 1, entries: 500, flagged: 0 })
    expect(reviewStats(db).byProject.map((p) => p.project)).toEqual(['Large', 'Small'])
  })
})

describe('reviewStats over a window', () => {
  it('counts only runs started on or after `since`', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 10, flagged: 0 })
    reviewed({ startedAt: MONDAY + 10 * DAY, tookMs: 1, entries: 7, flagged: 0 })
    expect(reviewStats(db, { since: MONDAY + 5 * DAY }).entries).toBe(7)
  })

  it('reports the span it actually covered, not the span it was asked for', () => {
    // The page prints this, and a window wider than the data would overstate it.
    reviewed({ startedAt: MONDAY + 2 * DAY, tookMs: 1, entries: 1, flagged: 0 })
    reviewed({ startedAt: MONDAY + 4 * DAY, tookMs: 1, entries: 1, flagged: 0 })
    const s = reviewStats(db, { since: MONDAY })
    expect(s.from).toBe(MONDAY + 2 * DAY)
    expect(s.to).toBe(MONDAY + 4 * DAY)
  })

  it('has no span when nothing is in the window', () => {
    reviewed({ startedAt: MONDAY, tookMs: 1, entries: 1, flagged: 0 })
    const s = reviewStats(db, { since: MONDAY + 30 * DAY })
    expect(s.from).toBeUndefined()
    expect(s.to).toBeUndefined()
  })
})
