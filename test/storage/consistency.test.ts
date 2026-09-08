import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { getConsistency, setConsistency } from '../../src/storage/consistency.js'

const entries = [
  { translation: 'Ayarlar', count: 42 },
  { translation: 'Seçenekler', count: 3 },
]

describe('consistency cache', () => {
  let home: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-consistency-'))
    db = openDb(join(home, 'polyglots.db'))
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  it('returns undefined for a miss', () => {
    expect(getConsistency(db, 'Settings', 'tr', 30)).toBeUndefined()
  })

  it('round-trips entries, keyed by text and locale', () => {
    const now = new Date('2026-09-07T10:00:00Z')
    setConsistency(db, 'Settings', 'tr', entries, 'core', () => now)
    expect(getConsistency(db, 'Settings', 'tr', 30, 'core', () => now)).toEqual(entries)
    expect(getConsistency(db, 'Settings', 'de', 30, 'core', () => now)).toBeUndefined()
    const row = db.prepare('SELECT fetched_at FROM consistency_cache').get() as { fetched_at: string }
    expect(row.fetched_at).toBe(now.toISOString())
  })

  it('expires after ttlDays', () => {
    const fetched = new Date('2026-09-07T10:00:00Z')
    setConsistency(db, 'Settings', 'tr', entries, 'core', () => fetched)
    const justInside = new Date(fetched.getTime() + 30 * 86_400_000 - 1)
    const justOutside = new Date(fetched.getTime() + 30 * 86_400_000 + 1)
    expect(getConsistency(db, 'Settings', 'tr', 30, 'core', () => justInside)).toEqual(entries)
    expect(getConsistency(db, 'Settings', 'tr', 30, 'core', () => justOutside)).toBeUndefined()
    expect(getConsistency(db, 'Settings', 'tr', 31, 'core', () => justOutside)).toEqual(entries)
  })

  it('keeps core and all scopes in separate rows', () => {
    const now = new Date('2026-09-07T10:00:00Z')
    const wide = [{ translation: 'Yan Menü', count: 82 }]
    setConsistency(db, 'Sidebar', 'tr', entries, 'core', () => now)
    setConsistency(db, 'Sidebar', 'tr', wide, 'all', () => now)

    expect(getConsistency(db, 'Sidebar', 'tr', 30, 'core', () => now)).toEqual(entries)
    expect(getConsistency(db, 'Sidebar', 'tr', 30, 'all', () => now)).toEqual(wide)
    const count = db.prepare('SELECT count(*) AS n FROM consistency_cache').get() as { n: number }
    expect(count.n).toBe(2)
  })

  it('defaults to the core scope', () => {
    const now = new Date('2026-09-07T10:00:00Z')
    setConsistency(db, 'Sidebar', 'tr', entries)
    expect(getConsistency(db, 'Sidebar', 'tr', 30, 'core', () => now)).toEqual(entries)
    expect(getConsistency(db, 'Sidebar', 'tr', 30, 'all', () => now)).toBeUndefined()
  })

  it('treats a corrupted row as a miss instead of throwing', () => {
    setConsistency(db, 'Settings', 'tr', entries)
    db.prepare('UPDATE consistency_cache SET results_json = ?').run('{not json')
    expect(getConsistency(db, 'Settings', 'tr', 30)).toBeUndefined()
  })

  it('overwrites an existing row and refreshes fetched_at', () => {
    const old = new Date('2026-01-01T00:00:00Z')
    const fresh = new Date('2026-09-07T00:00:00Z')
    setConsistency(db, 'Settings', 'tr', entries, 'core', () => old)
    setConsistency(db, 'Settings', 'tr', [], 'core', () => fresh)
    expect(getConsistency(db, 'Settings', 'tr', 30, 'core', () => fresh)).toEqual([])
    const count = db.prepare('SELECT count(*) AS n FROM consistency_cache').get() as { n: number }
    expect(count.n).toBe(1)
  })
})
