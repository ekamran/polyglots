import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { getDraft, getDraftVerdict, putDraft, putDraftVerdict } from '../../src/jobs/drafts.js'

let db: Database.Database
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-drafts-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const dk = { srcHash: 'aaaaaaaaaaaaaaaa', locale: 'tr' as const, engine: 'deepl' }
const vk = { ...dk, draftHash: 'dddddddddddddddd', configHash: 'cccccccccccccccc' }

describe('draft cache', () => {
  it('returns nothing for an entry it has not drafted', () => {
    expect(getDraft(db, dk)).toBeUndefined()
  })

  it('round-trips every plural form', () => {
    putDraft(db, dk, ['%d oge', '%d oge'])
    expect(getDraft(db, dk)).toEqual(['%d oge', '%d oge'])
  })

  it('keys on the engine, so DeepL and OpenAI drafts coexist', () => {
    putDraft(db, dk, ['Kaydet'])
    expect(getDraft(db, { ...dk, engine: 'openai' })).toBeUndefined()
  })

  it('overwrites rather than duplicating', () => {
    putDraft(db, dk, ['Kaydet'])
    putDraft(db, dk, ['Sakla'])
    expect(getDraft(db, dk)).toEqual(['Sakla'])
    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM draft').get()!.n).toBe(1)
  })

  it('reads an unparseable draft as a miss, never as half a translation', () => {
    putDraft(db, dk, ['Kaydet'])
    db.prepare('UPDATE draft SET text = ?').run('{not json')
    expect(getDraft(db, dk)).toBeUndefined()
  })
})

describe('draft verdict cache', () => {
  it('round-trips a review of a draft', () => {
    putDraftVerdict(db, vk, { text: ['Kaydet'], fuzzy: true, reason: 'check the register' })
    expect(getDraftVerdict(db, vk)).toEqual({ text: ['Kaydet'], fuzzy: true, reason: 'check the register' })
  })

  it('misses when the draft it judged has changed', () => {
    // The review judged a specific draft. A different draft is a different
    // question, which is why the draft has to be cached too for resume to work.
    putDraftVerdict(db, vk, { text: ['Kaydet'], fuzzy: false, reason: '' })
    expect(getDraftVerdict(db, { ...vk, draftHash: 'eeeeeeeeeeeeeeee' })).toBeUndefined()
  })

  it('misses when the prompt has changed', () => {
    putDraftVerdict(db, vk, { text: ['Kaydet'], fuzzy: false, reason: '' })
    expect(getDraftVerdict(db, { ...vk, configHash: 'ffffffffffffffff' })).toBeUndefined()
  })

  it('reads an unparseable verdict as a miss, never as a partial one', () => {
    putDraftVerdict(db, vk, { text: ['Kaydet'], fuzzy: false, reason: '' })
    db.prepare('UPDATE draft_verdict SET text = ?').run('{not json')
    expect(getDraftVerdict(db, vk)).toBeUndefined()
  })
})
