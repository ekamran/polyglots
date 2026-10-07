import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { lookupGlossary, replaceGlossary } from '../../src/storage/glossary.js'

describe('glossary', () => {
  let home: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-glossary-'))
    db = openDb(join(home, 'polyglots.db'))
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  it('replaces only the given locale', () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'plugin', translation: 'eklenti', partOfSpeech: 'noun' },
      { locale: 'tr', sourceTerm: 'theme', translation: 'tema' },
    ])
    replaceGlossary(db, 'de', [{ locale: 'de', sourceTerm: 'plugin', translation: 'Plugin' }])

    replaceGlossary(db, 'tr', [{ locale: 'tr', sourceTerm: 'widget', translation: 'bileşen', notes: 'UI' }])

    expect(lookupGlossary(db, 'plugin', 'tr')).toEqual([])
    expect(lookupGlossary(db, 'theme', 'tr')).toEqual([])
    expect(lookupGlossary(db, 'widget', 'tr')).toEqual([
      { locale: 'tr', sourceTerm: 'widget', translation: 'bileşen', notes: 'UI' },
    ])
    expect(lookupGlossary(db, 'plugin', 'de')).toEqual([{ locale: 'de', sourceTerm: 'plugin', translation: 'Plugin' }])
  })

  it('matches case-insensitively, exact before substring', () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'Post Type', translation: 'yazı türü' },
      { locale: 'tr', sourceTerm: 'post', translation: 'yazı', partOfSpeech: 'noun' },
      { locale: 'tr', sourceTerm: 'Post', translation: 'gönder', partOfSpeech: 'verb' },
      { locale: 'tr', sourceTerm: 'Repost', translation: 'yeniden paylaş' },
      { locale: 'tr', sourceTerm: 'Page', translation: 'sayfa' },
    ])
    const hits = lookupGlossary(db, 'POST', 'tr')
    expect(hits.slice(0, 2).map((h) => h.translation)).toEqual(['yazı', 'gönder'])
    expect(hits.slice(2).map((h) => h.sourceTerm)).toEqual(['Repost', 'Post Type'])
    expect(hits[0]?.partOfSpeech).toBe('noun')
    expect(lookupGlossary(db, 'post', 'de')).toEqual([])
  })

  it('treats LIKE wildcards in the term literally', () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: '100%', translation: '%100' },
      { locale: 'tr', sourceTerm: 'abc', translation: 'x' },
    ])
    expect(lookupGlossary(db, '%', 'tr').map((h) => h.sourceTerm)).toEqual(['100%'])
    expect(lookupGlossary(db, '_', 'tr')).toEqual([])
  })

  it('replacing with an empty list clears the locale', () => {
    replaceGlossary(db, 'tr', [{ locale: 'tr', sourceTerm: 'plugin', translation: 'eklenti' }])
    replaceGlossary(db, 'tr', [])
    expect(lookupGlossary(db, 'plugin', 'tr')).toEqual([])
  })
})
