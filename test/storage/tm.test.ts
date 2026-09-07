import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../src/storage/db.js'
import { findExactTm, searchTm, upsertTm } from '../../src/storage/tm.js'

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

  it('upsert dedups on source+locale+context and updates the target', () => {
    const inserted = upsertTm(db, [
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
      { source: 'Settings', target: 'Ayarlar', locale: 'tr' },
      { source: 'Settings', target: 'Einstellungen', locale: 'de' },
      { source: 'Settings', target: 'Ayarlar (menü)', locale: 'tr', context: 'menu' },
    ])
    expect(inserted).toBe(4)
    const rows = db.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }
    expect(rows.n).toBe(3)

    upsertTm(db, [{ source: 'Settings', target: 'Seçenekler', locale: 'tr', project: 'woo' }])
    const after = db.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }
    expect(after.n).toBe(3)
    const hit = findExactTm(db, 'Settings', 'tr')
    expect(hit?.target).toBe('Seçenekler')
    expect(hit?.project).toBe('woo')
    expect(hit?.context).toBeUndefined()
  })

  it('returns 0 for an empty batch', () => {
    expect(upsertTm(db, [])).toBe(0)
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
