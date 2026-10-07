import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { finishRun, startRun } from '../../src/jobs/runs.js'
import { writeStats } from '../../src/commands/stats.js'

let db: Database.Database
let dir: string

const MONDAY = Date.UTC(2026, 8, 7)
const DAY = 86_400_000

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-stats-cmd-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  if (db.open) db.close()
  await rm(dir, { recursive: true, force: true })
})

function reviewed(startedAt: number, entries: number, flagged: number, project = 'Plugins - P'): void {
  const id = startRun(
    db,
    { file: '/tmp/p-tr.po', project, command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
    () => startedAt,
  )
  finishRun(db, id, { entries, flagged, repaired: flagged, unreviewed: 0, approvable: entries - flagged, byCategory: { glossary: flagged } }, () => startedAt + 1000)
}

describe('writeStats', () => {
  it('returns the last twelve weeks and the five biggest projects for the terminal', async () => {
    for (let w = 0; w < 14; w++) reviewed(MONDAY + w * 7 * DAY, w + 1, 0, `Plugins - P${w % 7}`)
    const result = await writeStats({ jobsDb: db, out: join(dir, 'stats.html') })
    // Oldest first, and the two oldest weeks (1 and 2 entries) are the ones dropped.
    expect(result.weeks).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(result.topProjects).toHaveLength(5)
    const entries = result.topProjects.map((p) => p.entries)
    expect(entries).toEqual([...entries].sort((a, b) => b - a))
    expect(result.flagged).toBe(0)
  })

  it('writes the page where it was asked to', async () => {
    reviewed(MONDAY, 10, 4)
    const out = join(dir, 'report.html')
    await writeStats({ out, jobsDb: db })
    expect(existsSync(out)).toBe(true)
    expect(await readFile(out, 'utf8')).toContain('<!doctype html>')
  })

  it('reports what it wrote, so the caller can print a line about it', async () => {
    reviewed(MONDAY, 10, 4)
    const out = join(dir, 'report.html')
    const summary = await writeStats({ out, jobsDb: db })
    expect(summary).toMatchObject({ file: out, submissions: 1, entries: 10 })
  })

  it('creates the directory when it does not exist yet', async () => {
    reviewed(MONDAY, 10, 4)
    const out = join(dir, 'nested', 'deeper', 'report.html')
    await writeStats({ out, jobsDb: db })
    expect(existsSync(out)).toBe(true)
  })

  it('counts only what started on or after --since', async () => {
    reviewed(MONDAY, 10, 4)
    reviewed(MONDAY + 10 * DAY, 7, 1)
    const summary = await writeStats({ out: join(dir, 'r.html'), jobsDb: db, since: '2026-09-12' })
    expect(summary.entries).toBe(7)
  })

  it('refuses a --since it cannot read, rather than silently counting everything', async () => {
    await expect(writeStats({ out: join(dir, 'r.html'), jobsDb: db, since: 'last tuesday' })).rejects.toThrow(
      /since/i,
    )
  })

  it('writes a real page when nothing has been reviewed yet', async () => {
    const out = join(dir, 'r.html')
    const summary = await writeStats({ out, jobsDb: db })
    expect(summary.submissions).toBe(0)
    expect(await readFile(out, 'utf8')).toContain('</html>')
  })

  it('leaves a database it was handed open, because the caller owns it', async () => {
    await writeStats({ out: join(dir, 'r.html'), jobsDb: db })
    expect(db.open).toBe(true)
  })
})
