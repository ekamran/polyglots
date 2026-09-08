import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceGlossary } from '../../../src/storage/index.js'
import { exportGlossary } from '../../../src/commands/glossary-export.js'

const BOM = '﻿'

describe('exportGlossary', () => {
  let home: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-glossary-export-'))
    db = openDb(join(home, 'polyglots.db'))
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'archive', translation: 'arşiv', partOfSpeech: 'noun' },
      { locale: 'tr', sourceTerm: 'archive', translation: 'arşivle', partOfSpeech: 'verb' },
      {
        locale: 'tr',
        sourceTerm: 'accent color',
        translation: 'vurgu rengi',
        partOfSpeech: 'noun',
        notes: 'Renk paletleri için',
      },
    ])
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  const lines = (csv: string) => csv.replace(BOM, '').trimEnd().split('\n')

  it('emits a header and one semicolon-delimited row per entry', async () => {
    const result = await exportGlossary({ locale: 'tr', db })

    expect(result.entries).toBe(3)
    expect(lines(result.csv)).toEqual([
      'Term;Translation;Notes',
      'accent color;vurgu rengi;[noun] Renk paletleri için',
      'archive;arşiv;[noun]',
      'archive;arşivle;[verb]',
    ])
  })

  it('quotes fields containing the delimiter and doubles embedded quotes', async () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'editor', translation: 'düzenleyici', partOfSpeech: 'noun', notes: 'örneğin; şu' },
      { locale: 'tr', sourceTerm: 'appearance', translation: 'görünüm', partOfSpeech: 'noun', notes: 'the "look"' },
    ])

    expect(lines((await exportGlossary({ locale: 'tr', db })).csv)).toEqual([
      'Term;Translation;Notes',
      'appearance;görünüm;"[noun] the ""look"""',
      'editor;düzenleyici;"[noun] örneğin; şu"',
    ])
  })

  it('switches quoting to the comma delimiter when asked', async () => {
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'editor', translation: 'düzenleyici', partOfSpeech: 'noun', notes: 'a, b' },
    ])

    expect(lines((await exportGlossary({ locale: 'tr', db, delimiter: ',' })).csv)).toEqual([
      'Term,Translation,Notes',
      'editor,düzenleyici,"[noun] a, b"',
    ])
  })

  it('writes a UTF-8 BOM file to the given path, creating parent directories', async () => {
    const file = join(home, 'nested', 'glossary.csv')
    const result = await exportGlossary({ locale: 'tr', db, file })

    expect(result.file).toBe(file)
    const written = await readFile(file, 'utf8')
    expect(written.startsWith(BOM)).toBe(true)
    expect(written).toBe(result.csv)
    expect(written.endsWith('\n')).toBe(true)
  })

  it('returns the csv without touching disk when no path is given', async () => {
    const result = await exportGlossary({ locale: 'tr', db })
    expect(result.file).toBeUndefined()
  })

  it('throws when the locale has no cached glossary', async () => {
    await expect(exportGlossary({ locale: 'de', db })).rejects.toThrow(/glossary sync/)
  })
})
