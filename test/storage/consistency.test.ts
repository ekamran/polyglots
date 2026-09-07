import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { getConsistency, setConsistency } from '../../src/storage/consistency.js'

const entries = [
  { translation: 'Ayarlar', count: 42, projects: ['wp/dev', 'woocommerce'] },
  { translation: 'Seçenekler', count: 3, projects: ['some-plugin'] },
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
    setConsistency(db, 'Settings', 'tr', entries, () => now)
    expect(getConsistency(db, 'Settings', 'tr', 30, () => now)).toEqual(entries)
    expect(getConsistency(db, 'Settings', 'de', 30, () => now)).toBeUndefined()
    const row = db.prepare('SELECT fetched_at FROM consistency_cache').get() as { fetched_at: string }
    expect(row.fetched_at).toBe(now.toISOString())
  })

  it('expires after ttlDays', () => {
    const fetched = new Date('2026-09-07T10:00:00Z')
    setConsistency(db, 'Settings', 'tr', entries, () => fetched)
    const justInside = new Date(fetched.getTime() + 30 * 86_400_000 - 1)
    const justOutside = new Date(fetched.getTime() + 30 * 86_400_000 + 1)
    expect(getConsistency(db, 'Settings', 'tr', 30, () => justInside)).toEqual(entries)
    expect(getConsistency(db, 'Settings', 'tr', 30, () => justOutside)).toBeUndefined()
    expect(getConsistency(db, 'Settings', 'tr', 31, () => justOutside)).toEqual(entries)
  })

  it('overwrites an existing row and refreshes fetched_at', () => {
    const old = new Date('2026-01-01T00:00:00Z')
    const fresh = new Date('2026-09-07T00:00:00Z')
    setConsistency(db, 'Settings', 'tr', entries, () => old)
    setConsistency(db, 'Settings', 'tr', [], () => fresh)
    expect(getConsistency(db, 'Settings', 'tr', 30, () => fresh)).toEqual([])
    const count = db.prepare('SELECT count(*) AS n FROM consistency_cache').get() as { n: number }
    expect(count.n).toBe(1)
  })
})
