import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openJobsDb } from '../../src/jobs/db.js'

async function tempDb(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'polyglots-jobs-'))
  return { path: join(dir, 'jobs.db'), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

describe('openJobsDb', () => {
  it('creates every table', async () => {
    const { path, cleanup } = await tempDb()
    const db = openJobsDb(path)
    const names = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['run', 'entry', 'audit_verdict', 'draft', 'draft_verdict']))
    db.close()
    await cleanup()
  })

  it('uses WAL, so a development build and a stable build can share it', async () => {
    const { path, cleanup } = await tempDb()
    const db = openJobsDb(path)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
    await cleanup()
  })

  it('is idempotent, so opening an existing database does not throw', async () => {
    const { path, cleanup } = await tempDb()
    openJobsDb(path).close()
    expect(() => openJobsDb(path).close()).not.toThrow()
    await cleanup()
  })

  it('creates the directory when it does not exist', async () => {
    const { path, cleanup } = await tempDb()
    const nested = join(path, '..', 'deeper', 'jobs.db')
    expect(() => openJobsDb(nested).close()).not.toThrow()
    await cleanup()
  })
})
