import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/storage/db.js'
import { upsertTm, findExactTm } from '../../src/storage/tm.js'

describe('openDb', () => {
  let home: string
  const original = process.env.POLYGLOTS_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-db-'))
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = original
    await rm(home, { recursive: true, force: true })
  })

  it('creates the parent directory and all tables', async () => {
    const path = join(home, 'nested', 'deeper', 'polyglots.db')
    const db = openDb(path)
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(names).toEqual(expect.arrayContaining(['tm', 'glossary', 'consistency_cache', 'tm_fts']))
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('defaults to dbFile() under POLYGLOTS_HOME', async () => {
    process.env.POLYGLOTS_HOME = home
    const db = openDb()
    db.close()
    expect((await stat(join(home, 'data', 'polyglots.db'))).isFile()).toBe(true)
  })

  it('migrations are idempotent across reopen and keep data', () => {
    const path = join(home, 'polyglots.db')
    const first = openDb(path)
    upsertTm(first, [{ source: 'Save changes', target: 'Değişiklikleri kaydet', locale: 'tr' }])
    first.close()

    const second = openDb(path)
    expect(findExactTm(second, 'Save changes', 'tr')?.target).toBe('Değişiklikleri kaydet')
    const count = second.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }
    expect(count.n).toBe(1)
    second.close()
  })
})
