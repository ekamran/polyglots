import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { finishRun, startRun } from '../../src/jobs/runs.js'
import { buildPayload, buildPayloads } from '../../src/stats/payload.js'
import { RANGES, flagRows, heatmapStart, parseRange } from '../../src/stats/page/model.js'

let db: Database.Database
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-payload-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const DAY = 86_400_000
const NOW = new Date(Date.UTC(2026, 9, 7, 12))

function reviewed(daysAgo: number, entries: number, flagged: number, byCategory: Record<string, number> = {}): void {
  const at = NOW.getTime() - daysAgo * DAY
  const id = startRun(
    db,
    { file: '/tmp/p-tr.po', project: 'Alpha', command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
    () => at,
  )
  finishRun(db, id, { entries, flagged, repaired: 0, unreviewed: 0, approvable: 0, byCategory }, () => at + 60_000)
}

describe('parseRange', () => {
  it('accepts the four ranges and falls back to all for anything else', () => {
    for (const r of RANGES) expect(parseRange(r)).toBe(r)
    expect(parseRange('7d')).toBe('all')
    expect(parseRange(null)).toBe('all')
  })
})

describe('buildPayload', () => {
  it('counts only runs inside the range', () => {
    reviewed(5, 10, 1)
    reviewed(60, 20, 2)
    reviewed(400, 40, 4)
    expect(buildPayload(db, { range: '30d', now: NOW }).review.entries).toBe(10)
    expect(buildPayload(db, { range: '90d', now: NOW }).review.entries).toBe(30)
    expect(buildPayload(db, { range: '1y', now: NOW }).review.entries).toBe(30)
    expect(buildPayload(db, { range: 'all', now: NOW }).review.entries).toBe(70)
  })

  it('never reaches past a floor the caller set, whatever the range', () => {
    reviewed(5, 10, 1)
    reviewed(60, 20, 2)
    const floor = NOW.getTime() - 10 * DAY
    expect(buildPayload(db, { range: 'all', now: NOW, floor }).review.entries).toBe(10)
  })

  it('carries a year of daily activity whatever the range, for the heatmap', () => {
    reviewed(5, 10, 1)
    reviewed(200, 20, 2)
    const p = buildPayload(db, { range: '30d', now: NOW })
    expect(p.activity.map((d) => d.entries)).toEqual([20, 10])
  })

  // The heatmap is 53 whole weeks, so it starts up to six days more than a
  // year back. Activity cut at exactly 365 days left that first column empty.
  it('carries activity from the first day the heatmap draws', () => {
    const start = heatmapStart(NOW.getTime())
    expect(new Date(start).getDay()).toBe(1)
    expect(NOW.getTime() - start).toBeGreaterThan(364 * DAY)
    const at = start + 3_600_000
    const id = startRun(
      db,
      { file: '/tmp/p-tr.po', project: 'Alpha', command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
      () => at,
    )
    finishRun(db, id, { entries: 9, flagged: 0, repaired: 0, unreviewed: 0, approvable: 9, byCategory: {} }, () => at + 1000)
    expect(buildPayload(db, { range: '30d', now: NOW }).activity.map((d) => d.entries)).toEqual([9])
  })

  it('carries the last thirty days for the context lines under each figure', () => {
    reviewed(5, 10, 1)
    reviewed(200, 20, 2)
    const p = buildPayload(db, { range: 'all', now: NOW })
    expect(p.recent).toEqual({ submissions: 1, entries: 10, flagged: 1, drafted: 0 })
  })

  it('is plain JSON, so it survives the trip to the browser unchanged', () => {
    reviewed(5, 10, 1, { ampersand: 1 })
    const p = buildPayload(db, { range: 'all', now: NOW })
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
  })
})

describe('buildPayloads', () => {
  it('builds every range, for the standalone copy', () => {
    reviewed(5, 10, 1)
    const all = buildPayloads(db, { now: NOW })
    expect(Object.keys(all).sort()).toEqual([...RANGES].sort())
  })
})

describe('flagRows', () => {
  it('labels each key and says where it came from, rule checks first', () => {
    const rows = flagRows({ 'ai:register': 5, ampersand: 3, 'tm-conflict': 9 })
    expect(rows.map((r) => [r.key, r.source])).toEqual([
      ['tm-conflict', 'rule'],
      ['ampersand', 'rule'],
      ['ai:register', 'ai'],
    ])
  })

  it('keeps a key no current code writes, as other, rather than dropping it from the total', () => {
    const rows = flagRows({ 'retired-rule': 2 })
    expect(rows).toEqual([{ key: 'retired-rule', count: 2, source: 'other' }])
  })
})
