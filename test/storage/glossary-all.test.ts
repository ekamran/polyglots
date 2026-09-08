import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { allGlossary, replaceGlossary } from '../../src/storage/glossary.js'

describe('allGlossary', () => {
  let home: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-glossary-all-'))
    db = openDb(join(home, 'polyglots.db'))
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  it('returns every entry for the locale, sorted by term then part of speech', () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'comment', translation: 'yorum yap', partOfSpeech: 'verb' },
      { locale: 'tr', sourceTerm: 'archive', translation: 'arşiv', partOfSpeech: 'noun', notes: 'içerik' },
      { locale: 'tr', sourceTerm: 'comment', translation: 'yorum', partOfSpeech: 'noun' },
    ])

    expect(allGlossary(db, 'tr')).toEqual([
      { locale: 'tr', sourceTerm: 'archive', translation: 'arşiv', partOfSpeech: 'noun', notes: 'içerik' },
      { locale: 'tr', sourceTerm: 'comment', translation: 'yorum', partOfSpeech: 'noun' },
      { locale: 'tr', sourceTerm: 'comment', translation: 'yorum yap', partOfSpeech: 'verb' },
    ])
  })

  it('ignores other locales and returns [] when the locale has nothing', () => {
    replaceGlossary(db, 'de', [{ locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' }])
    expect(allGlossary(db, 'tr')).toEqual([])
  })
})
