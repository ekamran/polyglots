import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { getAuditVerdict, putAuditVerdict, pruneStaleConfigs } from '../../src/jobs/verdicts.js'

let db: Database.Database
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-verdicts-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const key = (over: Partial<Parameters<typeof getAuditVerdict>[1]> = {}) => ({
  srcHash: 'aaaaaaaaaaaaaaaa',
  configHash: 'bbbbbbbbbbbbbbbb',
  locale: 'tr' as const,
  engine: 'claude',
  ...over,
})

describe('audit verdict cache', () => {
  it('returns nothing for an entry it has not seen', () => {
    expect(getAuditVerdict(db, key())).toBeUndefined()
  })

  it('round-trips a flagged verdict with its fix', () => {
    putAuditVerdict(db, key(), { problem: true, categories: ['glossary'], reason: 'use kimlik', fix: ['Gorev kimligi'] })
    expect(getAuditVerdict(db, key())).toEqual({
      problem: true,
      categories: ['glossary'],
      reason: 'use kimlik',
      fix: ['Gorev kimligi'],
    })
  })

  it('round-trips a cleared verdict, which has no fix', () => {
    putAuditVerdict(db, key(), { problem: false, categories: [], reason: '' })
    const got = getAuditVerdict(db, key())
    expect(got).toEqual({ problem: false, categories: [], reason: '' })
    expect(got).not.toHaveProperty('fix')
  })

  it('keys on the entry, so a different entry misses', () => {
    putAuditVerdict(db, key(), { problem: true, categories: [], reason: 'x' })
    expect(getAuditVerdict(db, key({ srcHash: 'cccccccccccccccc' }))).toBeUndefined()
  })

  it('keys on the configuration, so a glossary change misses', () => {
    putAuditVerdict(db, key(), { problem: true, categories: [], reason: 'x' })
    expect(getAuditVerdict(db, key({ configHash: 'cccccccccccccccc' }))).toBeUndefined()
  })

  it('keys on the engine, so two engines coexist rather than overwrite', () => {
    putAuditVerdict(db, key({ engine: 'qwen' }), { problem: false, categories: [], reason: 'fine' })
    putAuditVerdict(db, key({ engine: 'claude' }), { problem: true, categories: [], reason: 'not fine' })
    expect(getAuditVerdict(db, key({ engine: 'qwen' }))?.problem).toBe(false)
    expect(getAuditVerdict(db, key({ engine: 'claude' }))?.problem).toBe(true)
  })

  it('overwrites rather than duplicating when the same entry is judged twice', () => {
    putAuditVerdict(db, key(), { problem: true, categories: [], reason: 'first' })
    putAuditVerdict(db, key(), { problem: false, categories: [], reason: 'second' })
    expect(getAuditVerdict(db, key())?.reason).toBe('second')
    const n = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM audit_verdict').get()!.n
    expect(n).toBe(1)
  })

  it('reads an unparseable categories column as a miss, not as a verdict with no categories', () => {
    // A verdict that lost its categories still looks intact to the caller, so
    // it would be trusted rather than re-asked, and the findings it drives
    // would silently differ from what the model actually said.
    putAuditVerdict(db, key(), { problem: true, categories: ['glossary'], reason: 'x' })
    db.prepare('UPDATE audit_verdict SET categories = ?').run('{not json')
    expect(getAuditVerdict(db, key())).toBeUndefined()
  })

  it('reads an unparseable fix column as a miss', () => {
    putAuditVerdict(db, key(), { problem: true, categories: [], reason: 'x', fix: ['a'] })
    db.prepare('UPDATE audit_verdict SET fix = ?').run('{not json')
    expect(getAuditVerdict(db, key())).toBeUndefined()
  })

  it('still reads a null fix as a hit, because a cleared entry has no repair', () => {
    putAuditVerdict(db, key(), { problem: false, categories: [], reason: '' })
    expect(getAuditVerdict(db, key())).toBeDefined()
  })

  it('reads an unrecognised category as a miss, not as a category it will pass on', () => {
    // Categories become ai:<category> findings written into the output file.
    // A row from an older build must not smuggle one this build cannot read.
    putAuditVerdict(db, key(), { problem: true, categories: ['glossary'], reason: 'x' })
    db.prepare('UPDATE audit_verdict SET categories = ?').run('["not-a-real-category"]')
    expect(getAuditVerdict(db, key())).toBeUndefined()
  })
})

describe('pruneStaleConfigs', () => {
  it('deletes verdicts from a previous configuration', () => {
    putAuditVerdict(db, key({ configHash: 'old0old0old0old0' }), { problem: true, categories: [], reason: 'x' })
    putAuditVerdict(db, key({ configHash: 'new0new0new0new0' }), { problem: true, categories: [], reason: 'y' })
    expect(pruneStaleConfigs(db, 'audit_verdict', 'tr', 'new0new0new0new0')).toBe(1)
    expect(getAuditVerdict(db, key({ configHash: 'old0old0old0old0' }))).toBeUndefined()
    expect(getAuditVerdict(db, key({ configHash: 'new0new0new0new0' }))).toBeDefined()
  })

  it('leaves other locales alone, because the glossary differs per locale', () => {
    // Without the locale predicate, reviewing a de submission would delete every
    // tr verdict, and reviewing a tr one would delete them straight back.
    putAuditVerdict(db, key({ locale: 'de', configHash: 'de00de00de00de00' }), {
      problem: true,
      categories: [],
      reason: 'x',
    })
    pruneStaleConfigs(db, 'audit_verdict', 'tr', 'new0new0new0new0')
    expect(getAuditVerdict(db, key({ locale: 'de', configHash: 'de00de00de00de00' }))).toBeDefined()
  })

  it('leaves the draft table alone when pruning audit verdicts', () => {
    // review and translate hash their configuration differently, so one must
    // never prune by the other's hash.
    db.prepare(
      `INSERT INTO draft_verdict (src_hash, draft_hash, config_hash, locale, engine, text, fuzzy, reason, at)
       VALUES ('a', 'b', 'old0old0old0old0', 'tr', 'claude', '["x"]', 0, '', 0)`,
    ).run()
    pruneStaleConfigs(db, 'audit_verdict', 'tr', 'new0new0new0new0')
    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM draft_verdict').get()!.n).toBe(1)
  })

  it('prunes the draft table when asked for it by name', () => {
    db.prepare(
      `INSERT INTO draft_verdict (src_hash, draft_hash, config_hash, locale, engine, text, fuzzy, reason, at)
       VALUES ('a', 'b', 'old0old0old0old0', 'tr', 'claude', '["x"]', 0, '', 0)`,
    ).run()
    pruneStaleConfigs(db, 'draft_verdict', 'tr', 'new0new0new0new0')
    const n = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM draft_verdict').get()!.n
    expect(n).toBe(0)
  })

  it('reports nothing pruned when the configuration has not moved', () => {
    putAuditVerdict(db, key(), { problem: true, categories: [], reason: 'x' })
    expect(pruneStaleConfigs(db, 'audit_verdict', 'tr', 'bbbbbbbbbbbbbbbb')).toBe(0)
  })
})
