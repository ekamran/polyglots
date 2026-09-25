import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseCtor from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { findExactTm, findMemory, searchTm, upsertTm } from '../../src/storage/tm.js'

describe('tm', () => {
  let home: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-tm-'))
    db = openDb(join(home, 'polyglots.db'))
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  /**
   * The memory holds every translation the locale approved for a source, not
   * the last one imported. Collapsing them made whichever alternative came last
   * in a TMX the one that answers for the source, which is arbitrary, and since
   * 0.14.0 that answer approves submissions without a model. A real export held
   * 6,480 sources with more than one approved wording.
   */
  it('keeps a second translation of the same source as an alternative', () => {
    upsertTm(db, [{ source: 'Scroll to Top', target: 'Tepeye kaydır', locale: 'tr' }])
    upsertTm(db, [{ source: 'Scroll to Top', target: 'Yukarı kaydır', locale: 'tr' }])

    expect(findMemory(db, 'Scroll to Top', 'tr').map((e) => e.target).sort()).toEqual(['Tepeye kaydır', 'Yukarı kaydır'])
  })

  it('still dedups a translation it already holds', () => {
    upsertTm(db, [
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
    ])
    expect(findMemory(db, 'Settings', 'tr')).toHaveLength(1)
  })

  // Alternatives belong to the context they were approved under. Mixing them
  // would hand a verb's translation to a noun.
  it('keeps each context own alternatives to itself', () => {
    upsertTm(db, [
      { source: 'Post', target: 'Yazı', locale: 'tr' },
      { source: 'Post', target: 'Gönderi', locale: 'tr' },
      { source: 'Post', target: 'Gönder', locale: 'tr', context: 'verb' },
    ])
    expect(findMemory(db, 'Post', 'tr', 'verb').map((e) => e.target)).toEqual(['Gönder'])
    expect(findMemory(db, 'Post', 'tr').map((e) => e.target).sort()).toEqual(['Gönderi', 'Yazı'])
    // The context-less fallback still applies when the scoped context has none.
    expect(findMemory(db, 'Post', 'tr', 'unknown').map((e) => e.target).sort()).toEqual(['Gönderi', 'Yazı'])
    expect(findMemory(db, 'Missing', 'tr')).toEqual([])
  })

  // For the callers that can only act on one, such as filling an untranslated
  // entry during a translate run.
  it('offers the most recently updated alternative first', () => {
    upsertTm(db, [{ source: 'Icon', target: 'İkon', locale: 'tr' }])
    upsertTm(db, [{ source: 'Icon', target: 'Simge', locale: 'tr' }])
    expect(findMemory(db, 'Icon', 'tr')[0]?.target).toBe('Simge')
    expect(findExactTm(db, 'Icon', 'tr')?.target).toBe('Simge')
  })

  it('upsert dedups on source+locale+context+target and refreshes what it holds', () => {
    const inserted = upsertTm(db, [
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
      { source: 'Settings', target: 'Einstellungen', locale: 'de' },
      { source: 'Settings', target: 'Ayarlar (menü)', locale: 'tr', context: 'menu' },
    ])
    expect(inserted).toBe(4)
    const rows = db.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }
    expect(rows.n).toBe(3)

    // A wording the memory does not hold yet joins the source rather than
    // replacing what is there.
    upsertTm(db, [{ source: 'Settings', target: 'Seçenekler', locale: 'tr', project: 'woo' }])
    const after = db.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }
    expect(after.n).toBe(4)
    const hit = findExactTm(db, 'Settings', 'tr')
    expect(hit?.target).toBe('Seçenekler')
    expect(hit?.project).toBe('woo')
    expect(hit?.context).toBeUndefined()
    expect(findMemory(db, 'Settings', 'tr').map((e) => e.target).sort()).toEqual(['Ayarlar', 'Seçenekler'])
  })

  it('returns 0 for an empty batch', () => {
    expect(upsertTm(db, [])).toBe(0)
  })

  /**
   * A database written before alternatives were kept carries a unique
   * constraint that allows only one translation per source. Opening it has to
   * rebuild the table, keep every row, and leave the full text index working.
   */
  it('migrates a database that could only hold one translation per source', async () => {
    const old = join(home, 'old.db')
    const raw = new DatabaseCtor(old)
    raw.exec(`
      CREATE TABLE tm (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL, locale TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '', project TEXT, updated_at TEXT NOT NULL,
        UNIQUE (source, locale, context)
      );
      INSERT INTO tm (source, target, locale, context, project, updated_at)
      VALUES ('Scroll to Top', 'Tepeye kaydır', 'tr', '', 'core', '2020-01-01T00:00:00.000Z');
    `)
    raw.close()

    const migrated = openDb(old)
    try {
      expect(findMemory(migrated, 'Scroll to Top', 'tr').map((e) => e.target)).toEqual(['Tepeye kaydır'])
      upsertTm(migrated, [{ source: 'Scroll to Top', target: 'Yukarı kaydır', locale: 'tr' }])
      expect(findMemory(migrated, 'Scroll to Top', 'tr')).toHaveLength(2)
      // The index is content-backed by the table that was just replaced.
      expect(searchTm(migrated, 'Scroll to Top', 'tr').length).toBeGreaterThan(0)
    } finally {
      migrated.close()
    }
  })

  it('prefers a context-specific match and falls back to context-less', () => {
    upsertTm(db, [
      { source: 'Post', target: 'Yazı', locale: 'tr' },
      { source: 'Post', target: 'Gönder', locale: 'tr', context: 'verb' },
    ])
    expect(findExactTm(db, 'Post', 'tr', 'verb')?.target).toBe('Gönder')
    expect(findExactTm(db, 'Post', 'tr', 'verb')?.context).toBe('verb')
    expect(findExactTm(db, 'Post', 'tr', 'unknown-ctx')?.target).toBe('Yazı')
    expect(findExactTm(db, 'Post', 'tr')?.target).toBe('Yazı')
    expect(findExactTm(db, 'Post', 'de')).toBeUndefined()
    expect(findExactTm(db, 'Missing', 'tr')).toBeUndefined()
  })

  it('does not fall back to a contextual entry when no context-less one exists', () => {
    upsertTm(db, [{ source: 'Post', target: 'Gönder', locale: 'tr', context: 'verb' }])
    expect(findExactTm(db, 'Post', 'tr')).toBeUndefined()
    expect(findExactTm(db, 'Post', 'tr', 'noun')).toBeUndefined()
  })

  describe('searchTm', () => {
    beforeEach(() => {
      upsertTm(db, [
        { source: 'Save changes to your profile', target: 'Profilinizdeki değişiklikleri kaydedin', locale: 'tr' },
        { source: 'Discard changes', target: 'Değişiklikleri sil', locale: 'tr' },
        { source: 'Upload a new image', target: 'Yeni bir görsel yükle', locale: 'tr' },
        { source: 'Save changes', target: 'Änderungen speichern', locale: 'de' },
      ])
    })

    it('returns a near match for a partially matching phrase, scoped to locale', () => {
      const results = searchTm(db, 'Save your changes', 'tr')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.source).toBe('Save changes to your profile')
      expect(results.every((r) => r.locale === 'tr')).toBe(true)
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0)
        expect(r.score).toBeLessThan(1)
      }
      expect(results.map((r) => r.source)).not.toContain('Upload a new image')
    })

    it('ranks better matches first', () => {
      const results = searchTm(db, 'save changes profile', 'tr')
      expect(results[0]?.source).toBe('Save changes to your profile')
      expect(results[1]?.source).toBe('Discard changes')
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
    })

    it('gives an exact match a score of 1', () => {
      const results = searchTm(db, 'Discard changes', 'tr')
      expect(results[0]?.source).toBe('Discard changes')
      expect(results[0]?.score).toBe(1)
    })

    it('returns nothing for garbage', () => {
      expect(searchTm(db, 'xyzzy qwertyuiop', 'tr')).toEqual([])
      expect(searchTm(db, '', 'tr')).toEqual([])
    })

    it('does not throw on FTS special characters', () => {
      expect(() => searchTm(db, 'save "changes* OR (NOT) - ^ : {x}', 'tr')).not.toThrow()
      expect(searchTm(db, '"changes*', 'tr').length).toBeGreaterThan(0)
      expect(searchTm(db, '*** "" ()', 'tr')).toEqual([])
    })

    it('respects the limit', () => {
      expect(searchTm(db, 'changes', 'tr', 1)).toHaveLength(1)
    })
  })
})
