import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, upsertTm } from '../../../src/storage/index.js'
import { openJobsDb } from '../../../src/jobs/db.js'
import { putDraft } from '../../../src/jobs/index.js'
import { saveConfig } from '../../../src/config.js'
import { translateFile, type TranslateOptions } from '../../../src/commands/translate.js'
import { CTX, collect, entryOf, fakeEngine, fakeReview, makeWorkspace, ofType, parseFile, type Workspace } from './helpers.js'

// Translate with no draft engine, and with no reviewer. Every test runs with
// no agent on PATH and no API key, so anything that reached for one would
// throw or fail a batch rather than pass.

let ws: Workspace
let db: Database.Database
let jobsDb: Database.Database
let saved: NodeJS.ProcessEnv

beforeEach(async () => {
  saved = { ...process.env }
  ws = await makeWorkspace()
  process.env.PATH = ''
  process.env.POLYGLOTS_AGENT_BIN = '/nonexistent/agent'
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
  db = openDb(join(ws.home, 'tm.db'))
  jobsDb = openJobsDb(join(ws.home, 'jobs-test.db'))
  upsertTm(db, [
    { source: 'Save Changes', target: 'Değişiklikleri kaydet', locale: 'tr' },
    { source: 'One submission was deleted.', target: 'Bir gönderim silindi.', locale: 'tr' },
    { source: '%d submissions were deleted.', target: '%d gönderim silindi.', locale: 'tr' },
  ])
})

afterEach(async () => {
  db.close()
  jobsDb.close()
  await ws.cleanup()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

function base(overrides: Partial<TranslateOptions> = {}): TranslateOptions {
  return { file: ws.file, locale: 'tr', mode: 'pending', draftEngine: 'none', batchSize: 25, db, jobsDb, ...overrides }
}

describe('translate --draft-engine none', () => {
  it('fills from the memory, drafts nothing, and counts what it left untranslated', async () => {
    const { events, onProgress } = collect()
    const summary = await translateFile(base({ onProgress }))

    expect(summary).toEqual({
      file: ws.file,
      total: 12,
      pending: 7,
      fromTm: 2,
      translated: 0,
      fuzzy: 0,
      skipped: 0,
      untranslated: 5,
    })
    expect(ofType(events, 'batch-start')).toHaveLength(0)
    const after = await parseFile(ws.file)
    expect(entryOf(after, 'Save Changes').msgstr).toEqual(['Değişiklikleri kaydet'])
    // The rest is left exactly as it was: an empty entry stays empty, and a
    // fuzzy one keeps its text and its flag, since nothing replaced it.
    expect(entryOf(after, 'Thank you for installing %s.').msgstr).toEqual([''])
    expect(entryOf(after, 'Form entries').msgstr).toEqual(['Form kayıtları'])
    expect(entryOf(after, 'Form entries').comments?.flag).toBe('fuzzy')
    expect(entryOf(after, `post type singular name${CTX}Form`).msgstr).toEqual([''])
  })

  it('records the run as drafted by nothing', async () => {
    await translateFile(base())
    const row = jobsDb.prepare<[], { engine: string; state: string }>('SELECT engine, state FROM run ORDER BY id DESC LIMIT 1').get()!
    expect(row).toEqual({ engine: 'none', state: 'done' })
  })

  it('does not resolve the local reviewer, which it never asks', async () => {
    // An OpenAI-compatible server with no model refuses any run that uses it.
    saveConfig({ reviewProvider: 'local', localServerKind: 'openai-compatible' })
    const summary = await translateFile(base())
    expect(summary.untranslated).toBe(5)
  })

  it('prunes no cached drafts, since it neither reads nor writes one', async () => {
    putDraft(jobsDb, { srcHash: 'x', configHash: 'an-older-prompt', locale: 'tr', engine: 'deepl' }, ['eski'])
    await translateFile(base())
    expect(jobsDb.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM draft').get()!.n).toBe(1)
  })
})

describe('translate with reviewProvider none', () => {
  it('writes the engine drafts fuzzy for a human, without asking a reviewer', async () => {
    saveConfig({ reviewProvider: 'none' })
    const engine = fakeEngine()
    const review = fakeReview()
    const summary = await translateFile(base({ draftEngine: 'deepl', engine, review }))

    expect(review.calls).toHaveLength(0)
    expect(engine.calls).toHaveLength(1)
    expect(summary).toMatchObject({ fromTm: 2, translated: 5, fuzzy: 5 })
    const after = await parseFile(ws.file)
    expect(entryOf(after, 'Thank you for installing %s.').msgstr).toEqual(['[draft] Thank you for installing %s.'])
    expect(entryOf(after, 'Thank you for installing %s.').comments?.flag).toContain('fuzzy')
  })

  it('caches no review verdict', async () => {
    // No review injected: the real one would spawn an agent, which is not on
    // PATH, so every batch would be skipped if anything still asked it.
    const summary = await translateFile(base({ draftEngine: 'deepl', engine: fakeEngine(), provider: 'none' }))
    expect(summary).toMatchObject({ translated: 5, skipped: 0 })
    expect(jobsDb.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM draft_verdict').get()!.n).toBe(0)
  })
})
