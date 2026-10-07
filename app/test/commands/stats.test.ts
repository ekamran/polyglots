import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { finishRun, startRun } from '../../src/jobs/runs.js'
import { serveStats, summarizeStats, writeStats } from '../../src/commands/stats.js'
import type { StatsServer } from '../../src/stats/server.js'

let db: Database.Database
let dir: string

const MONDAY = Date.UTC(2026, 8, 7)
const DAY = 86_400_000
// Bytes. The fixture below came to about 530 KB when this was set. Most mail
// servers take 10 MB or more, so the budget is about not drifting: a change
// that doubles the copy should have to say so here.
const BUDGET = 1_000_000

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

function embedded(html: string): { mode: string; payloads: Record<string, unknown> } {
  const m = /<script type="application\/json" id="stats-data">([^<]*)<\/script>/.exec(html)!
  return JSON.parse(m[1]!)
}

describe('writeStats standalone copy', () => {
  it('carries every range, so its range buttons work with no server behind it', async () => {
    reviewed(Date.now() - 5 * DAY, 10, 4)
    const out = join(dir, 'r.html')
    await writeStats({ out, jobsDb: db })
    const data = embedded(await readFile(out, 'utf8'))
    expect(data.mode).toBe('static')
    expect(Object.keys(data.payloads).sort()).toEqual(['1y', '30d', '90d', 'all'])
  })

  // The copy is for mailing and archiving. A locale with a long history
  // should still produce something an inbox accepts without a second look.
  it('stays small enough to email with two years of daily reviews over 500 projects', async () => {
    const insert = db.transaction(() => {
      const start = Date.now() - 730 * DAY
      for (let d = 0; d < 730; d++) {
        for (let k = 0; k < 2; k++) reviewed(start + d * DAY + k * 1000, 50, 5, `Project ${(d * 2 + k) % 500}`)
      }
    })
    insert()
    const out = join(dir, 'big.html')
    await writeStats({ out, jobsDb: db })
    const size = Buffer.byteLength(await readFile(out, 'utf8'))
    expect(size).toBeLessThan(BUDGET)
  })
})

describe('summarizeStats', () => {
  it('gives the terminal summary without writing anything', () => {
    reviewed(MONDAY, 10, 4)
    const s = summarizeStats(db, {})
    expect(s).toMatchObject({ submissions: 1, entries: 10, flagged: 4 })
    expect(s).not.toHaveProperty('file')
  })
})

describe('serveStats', () => {
  function fakeServer(): { server: StatsServer; closed: () => boolean } {
    let closed = false
    return {
      server: { url: 'http://127.0.0.1:9/t/', port: 9, close: async () => void (closed = true) },
      closed: () => closed,
    }
  }

  it('starts the server, opens the browser, reports, and closes everything once stopped', async () => {
    reviewed(MONDAY, 10, 4)
    const fake = fakeServer()
    let stop!: () => void
    const ready: unknown[] = []
    const done = serveStats(
      {
        jobsDb: db,
        start: async () => fake.server,
        openBrowser: async () => true,
        untilStopped: () => new Promise<void>((r) => (stop = r)),
      },
      (r) => ready.push(r),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(ready).toEqual([expect.objectContaining({ url: 'http://127.0.0.1:9/t/', opened: true, summary: expect.objectContaining({ entries: 10 }) })])
    expect(fake.closed()).toBe(false)
    stop()
    await done
    expect(fake.closed()).toBe(true)
  })

  it('does not open the browser when asked not to', async () => {
    const fake = fakeServer()
    let opened = false
    const ready: Array<{ opened: boolean }> = []
    await serveStats(
      {
        jobsDb: db,
        open: false,
        start: async () => fake.server,
        openBrowser: async () => (opened = true),
        untilStopped: async () => {},
      },
      (r) => ready.push(r),
    )
    expect(opened).toBe(false)
    expect(ready[0]!.opened).toBe(false)
  })

  it('refuses a --since it cannot read before starting anything', async () => {
    let started = false
    await expect(
      serveStats({ jobsDb: db, since: 'yesterday-ish', start: async () => ((started = true), fakeServer().server) }, () => {}),
    ).rejects.toThrow(/since/i)
    expect(started).toBe(false)
  })
})
