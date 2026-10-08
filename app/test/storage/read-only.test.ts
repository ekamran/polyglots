import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { readOnly } from '../../src/storage/read-only.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-readonly-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readOnly', () => {
  it('reads through a handle that cannot write', () => {
    const path = join(dir, 'x.db')
    const setup = new Database(path)
    setup.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('a')")
    setup.close()
    expect(readOnly(path, (db) => (db.prepare('SELECT v FROM t').get() as { v: string }).v, '')).toBe('a')
    expect(readOnly(path, (db) => (db.exec("INSERT INTO t VALUES ('b')"), 'wrote'), 'refused')).toBe('refused')
  })

  it('gives the fallback without creating a database that is not there', () => {
    const path = join(dir, 'missing.db')
    expect(readOnly(path, () => 1, 0)).toBe(0)
    expect(existsSync(path)).toBe(false)
  })

  it('leaves a rollback-journal database in that mode', () => {
    const path = join(dir, 'journal.db')
    const setup = new Database(path)
    setup.exec('CREATE TABLE t (v TEXT)')
    setup.close()
    readOnly(path, (db) => db.prepare('SELECT COUNT(*) FROM t').get(), undefined)
    const check = new Database(path, { readonly: true })
    expect(check.pragma('journal_mode', { simple: true })).toBe('delete')
    check.close()
  })
})
