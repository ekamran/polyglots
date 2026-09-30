import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const opened: Database.Database[] = []

vi.mock('../../../src/storage/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/index.js')>()
  return {
    ...actual,
    openDb: (path?: string) => {
      const db = actual.openDb(path)
      opened.push(db)
      return db
    },
    upsertTm: vi.fn(actual.upsertTm),
  }
})

import { findExactTm, openDb, upsertTm } from '../../../src/storage/index.js'
import { dbFile } from '../../../src/paths.js'
import { importTmx, type TmImportProgress } from '../../../src/commands/tm-import.js'

const SAMPLE = join(import.meta.dirname, '..', '..', 'fixtures', 'tmx', 'sample.tmx')
const SAMPLE_TR_ENTRIES = 5

const SECOND_TMX = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Poedit" srclang="en" segtype="sentence" o-tmf="PoeditTM" adminlang="en" datatype="plaintext"/>
  <body>
    <tu>
      <tuv xml:lang="en"><seg>Publish</seg></tuv>
      <tuv xml:lang="tr"><seg>Yayımla</seg></tuv>
    </tu>
    <tu>
      <tuv xml:lang="en"><seg>Draft</seg></tuv>
      <tuv xml:lang="tr"><seg>Taslak</seg></tuv>
    </tu>
  </body>
</tmx>
`

const NO_TR_TMX = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Poedit" srclang="en" segtype="sentence" o-tmf="PoeditTM" adminlang="en" datatype="plaintext"/>
  <body>
    <tu>
      <tuv xml:lang="en"><seg>Publish</seg></tuv>
      <tuv xml:lang="de"><seg>Veröffentlichen</seg></tuv>
    </tu>
  </body>
</tmx>
`

const BROKEN_TMX = '<tmx><body><tu></body></tmx>'

function countTm(db: Database.Database): number {
  return (db.prepare('SELECT count(*) AS n FROM tm').get() as { n: number }).n
}

describe('importTmx', () => {
  let home: string
  let second: string
  let previousHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-tm-import-'))
    previousHome = process.env.POLYGLOTS_HOME
    process.env.POLYGLOTS_HOME = home
    second = join(home, 'second.tmx')
    await writeFile(second, SECOND_TMX, 'utf8')
    opened.length = 0
    vi.mocked(upsertTm).mockClear()
  })

  afterEach(async () => {
    for (const db of opened) if (db.open) db.close()
    if (previousHome === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  it('imports every file and reports totals', async () => {
    const db = openDb(join(home, 'injected.db'))
    const result = await importTmx([SAMPLE, second], { locale: 'tr', db })
    expect(result).toMatchObject({ files: 2, entries: SAMPLE_TR_ENTRIES + 2 })
    expect(countTm(db)).toBe(SAMPLE_TR_ENTRIES + 2)
  })

  it('emits one progress event per file in order', async () => {
    const db = openDb(join(home, 'injected.db'))
    const events: TmImportProgress[] = []
    await importTmx([SAMPLE, second], { locale: 'tr', db, onProgress: (e) => events.push(e) })
    expect(events.map((e) => ({ file: e.file, entries: e.entries }))).toEqual([
      { file: SAMPLE, entries: SAMPLE_TR_ENTRIES },
      { file: second, entries: 2 },
    ])
  })

  // upsertTm currently returns batch.length, so upserted would equal entries by accident;
  // this pins the aggregation itself by making storage report a smaller count.
  it('reports upserted as the sum of what storage returns, per file and in total', async () => {
    const db = openDb(join(home, 'injected.db'))
    vi.mocked(upsertTm).mockReturnValueOnce(1)
    const events: TmImportProgress[] = []
    const result = await importTmx([SAMPLE, second], { locale: 'tr', db, onProgress: (e) => events.push(e) })
    expect(events.map((e) => e.upserted)).toEqual([1, 2])
    expect(result.upserted).toBe(3)
    expect(result.entries).toBe(SAMPLE_TR_ENTRIES + 2)
  })

  it('passes locale and project through to the stored entries', async () => {
    const db = openDb(join(home, 'injected.db'))
    await importTmx([SAMPLE], { locale: 'de', project: 'wp-core', db })
    const rows = db.prepare('SELECT source, target, locale, project FROM tm').all()
    expect(rows).toEqual([{ source: 'Settings', target: 'Einstellungen', locale: 'de', project: 'wp-core' }])
  })

  it('re-importing the same files is idempotent', async () => {
    const db = openDb(join(home, 'injected.db'))
    const first = await importTmx([SAMPLE, second], { locale: 'tr', db })
    const again = await importTmx([SAMPLE, second], { locale: 'tr', db })
    expect(again).toEqual(first)
    expect(countTm(db)).toBe(SAMPLE_TR_ENTRIES + 2)
    const post = db
      .prepare("SELECT target FROM tm WHERE source = 'Post' AND locale = 'tr' AND context = 'verb'")
      .all()
    expect(post).toEqual([{ target: 'Gönder' }])
  })

  it('does not close an injected db', async () => {
    const db = openDb(join(home, 'injected.db'))
    await importTmx([second], { locale: 'tr', db })
    expect(db.open).toBe(true)
    expect(countTm(db)).toBe(2)
    expect(opened).toHaveLength(1)
  })

  it('opens its own db at dbFile() and closes it afterwards, rows persisting', async () => {
    const result = await importTmx([SAMPLE, second], { locale: 'tr' })
    expect(result.files).toBe(2)
    expect(opened).toHaveLength(1)
    expect(opened[0].open).toBe(false)

    const reopened = openDb(dbFile())
    expect(reopened.name).toBe(join(home, 'data', 'polyglots.db'))
    expect(countTm(reopened)).toBe(SAMPLE_TR_ENTRIES + 2)
  })

  it('rejects on a missing file naming the path, keeps earlier files, and emits no progress for or after it', async () => {
    const db = openDb(join(home, 'injected.db'))
    const missing = join(home, 'nope.tmx')
    const events: string[] = []
    await expect(
      importTmx([second, missing, SAMPLE], { locale: 'tr', db, onProgress: (e) => events.push(e.file) }),
    ).rejects.toThrow(missing)
    expect(events).toEqual([second])
    expect(countTm(db)).toBe(2)
    expect(db.open).toBe(true)
  })

  it('emits progress only after the upsert succeeded', async () => {
    const db = openDb(join(home, 'injected.db'))
    vi.mocked(upsertTm).mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const events: string[] = []
    await expect(
      importTmx([second, SAMPLE], { locale: 'tr', db, onProgress: (e) => events.push(e.file) }),
    ).rejects.toThrow('disk full')
    expect(events).toEqual([])
    expect(countTm(db)).toBe(0)
  })

  it('closes an owned db even when a file fails', async () => {
    const missing = join(home, 'nope.tmx')
    await expect(importTmx([second, missing], { locale: 'tr' })).rejects.toThrow(missing)
    expect(opened).toHaveLength(1)
    expect(opened[0].open).toBe(false)
    expect(countTm(openDb(dbFile()))).toBe(2)
  })

  it('normalizes the locale so stored rows match canonical lookups', async () => {
    const db = openDb(join(home, 'injected.db'))
    await importTmx([SAMPLE], { locale: 'tr_TR', db })
    await importTmx([second], { locale: ' TR ', db })
    const locales = db.prepare('SELECT DISTINCT locale FROM tm ORDER BY locale').all()
    expect(locales).toEqual([{ locale: 'tr' }, { locale: 'tr-tr' }])
    expect(findExactTm(db, 'Save changes', 'tr-tr')).toMatchObject({ target: 'Değişiklikleri kaydet' })
    expect(findExactTm(db, 'Publish', 'tr')).toMatchObject({ target: 'Yayımla' })
  })

  it('rejects an empty locale before opening a db', async () => {
    await expect(importTmx([SAMPLE], { locale: '  ' })).rejects.toThrow(/locale/i)
    expect(opened).toHaveLength(0)
  })

  it('imports paths exactly as given, including duplicates, and counts each', async () => {
    const db = openDb(join(home, 'injected.db'))
    const events: string[] = []
    const result = await importTmx([SAMPLE, second, SAMPLE], {
      locale: 'tr',
      db,
      onProgress: (e) => events.push(e.file),
    })
    expect(result).toMatchObject({ files: 3, entries: SAMPLE_TR_ENTRIES * 2 + 2 })
    expect(events).toEqual([SAMPLE, second, SAMPLE])
    expect(countTm(db)).toBe(SAMPLE_TR_ENTRIES + 2)
  })

  it('counts a file with no entries for the locale and emits its progress event', async () => {
    const db = openDb(join(home, 'injected.db'))
    const noTr = join(home, 'no-tr.tmx')
    await writeFile(noTr, NO_TR_TMX, 'utf8')
    const events: TmImportProgress[] = []
    const result = await importTmx([noTr], { locale: 'tr', db, onProgress: (e) => events.push(e) })
    expect(result).toEqual({ files: 1, entries: 0, upserted: 0 })
    expect(events).toEqual([{ file: noTr, entries: 0, upserted: 0 }])
    expect(countTm(db)).toBe(0)
  })

  it('names the file when the TMX is invalid and does not repeat a path the error already carries', async () => {
    const db = openDb(join(home, 'injected.db'))
    const broken = join(home, 'broken.tmx')
    await writeFile(broken, BROKEN_TMX, 'utf8')
    await expect(importTmx([broken], { locale: 'tr', db })).rejects.toThrow(`Failed to import ${broken}: Invalid TMX`)

    const missing = join(home, 'nope.tmx')
    const error = await importTmx([missing], { locale: 'tr', db }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.split(missing).length - 1).toBe(1)
  })

  it('wraps a parse error even when the raw path happens to appear in its text', async () => {
    const db = openDb(join(home, 'injected.db'))
    await writeFile(join(home, 'line'), BROKEN_TMX, 'utf8')
    const cwd = process.cwd()
    process.chdir(home)
    try {
      await expect(importTmx(['line'], { locale: 'tr', db })).rejects.toThrow(/^Failed to import line: Invalid TMX/)
    } finally {
      process.chdir(cwd)
    }
  })

  it('returns zeros for an empty file list without opening a db', async () => {
    const result = await importTmx([], { locale: 'tr' })
    expect(result).toEqual({ files: 0, entries: 0, upserted: 0 })
    expect(opened).toHaveLength(0)
  })
})

/**
 * translate.wordpress.org exports `.po`, not TMX, and a locale team's approved
 * work is most directly imported from there: 66 project exports carry 69,302
 * approved Turkish strings. Converting each one to TMX first is a step with
 * nothing to decide in it.
 */
describe('importTmx reading a .po export', () => {
  const PO = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"

msgid "Publish"
msgstr "Yayımla"

msgctxt "post status"
msgid "Draft"
msgstr "Taslak"

msgid "%d item"
msgid_plural "%d items"
msgstr[0] "%d öge"
msgstr[1] "%d öge"

msgid "Never translated"
msgstr ""

#, fuzzy
msgid "Needs work"
msgstr "Çalışma gerekiyor"
`
  let home: string
  let db: Database.Database
  let file: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-po-import-'))
    file = join(home, 'wp-dev-tr.po')
    await writeFile(file, PO, 'utf8')
    db = openDb(join(home, 'polyglots.db'))
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  it('imports the translated entries, keeping the context', async () => {
    const result = await importTmx([file], { locale: 'tr', db })

    expect(findExactTm(db, 'Publish', 'tr')?.target).toBe('Yayımla')
    expect(findExactTm(db, 'Draft', 'tr', 'post status')?.target).toBe('Taslak')
    expect(result.files).toBe(1)
  })

  // The memory holds one string per source, and translate reads a plural entry
  // back by looking up each source separately.
  it('stores both halves of a plural entry', async () => {
    await importTmx([file], { locale: 'tr', db })

    expect(findExactTm(db, '%d item', 'tr')?.target).toBe('%d öge')
    expect(findExactTm(db, '%d items', 'tr')?.target).toBe('%d öge')
  })

  // An export filtered to current strings should carry neither, but a file
  // saved from an editor will.
  it('skips what nobody approved: empty and fuzzy entries', async () => {
    await importTmx([file], { locale: 'tr', db })

    expect(findExactTm(db, 'Never translated', 'tr')).toBeUndefined()
    expect(findExactTm(db, 'Needs work', 'tr')).toBeUndefined()
  })

  it('still reads TMX, chosen by what the file holds rather than its name', async () => {
    const tmx = join(home, 'looks-like-anything.po')
    await writeFile(tmx, SECOND_TMX, 'utf8')
    await importTmx([tmx], { locale: 'tr', db })

    expect(findExactTm(db, 'Publish', 'tr')?.target).toBe('Yayımla')
  })

  it('names the file when it is neither', async () => {
    const junk = join(home, 'junk.po')
    await writeFile(junk, 'this is not a catalogue', 'utf8')
    await expect(importTmx([junk], { locale: 'tr', db })).rejects.toThrow(/junk\.po/)
  })
})
