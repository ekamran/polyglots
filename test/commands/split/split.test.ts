import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { po as gettext } from 'gettext-parser'
import { partCount, partName, splitPo } from '../../../src/commands/split.js'
import { UsageError } from '../../../src/cli/args.js'

let dir: string

const HEADER = `msgid ""
msgstr ""
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"
"X-Generator: GlotPress/4.1.0\\n"
"PO-Revision-Date: 2026-09-14 09:35+0000\\n"
`

function catalogue(n: number, extra = ''): string {
  const entries = Array.from({ length: n }, (_, i) => `msgid "Source ${i + 1}"\nmsgstr "Kaynak ${i + 1}"\n`)
  return [HEADER, ...entries, extra].join('\n')
}

async function write(name: string, body: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, body)
  return path
}

async function parsePart(path: string) {
  return gettext.parse(await readFile(path))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-split-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('partCount', () => {
  // The numbers from the request: an exact slice with a short final part.
  it('gives a final short part rather than balancing', () => {
    expect(partCount(9326, 1000)).toBe(10)
    expect(partCount(9326, 500)).toBe(19)
  })

  it('needs no second part for an exact fit', () => {
    expect(partCount(1000, 1000)).toBe(1)
    expect(partCount(999, 1000)).toBe(1)
  })

  it('is zero parts for nothing to split', () => {
    expect(partCount(0, 500)).toBe(0)
  })
})

describe('partName', () => {
  // The picker sorts by name, where -1, -10, -100, -11 is the order a bare
  // index produces. The width follows the count so the listing reads in order.
  it('pads the index to the width the part count needs', () => {
    expect(partName('plugin-tr', 1, 9)).toBe('plugin-tr-01.po')
    expect(partName('plugin-tr', 1, 19)).toBe('plugin-tr-01.po')
    expect(partName('plugin-tr', 7, 120)).toBe('plugin-tr-007.po')
    expect(partName('plugin-tr', 120, 120)).toBe('plugin-tr-120.po')
  })
})

describe('splitPo', () => {
  it('writes the parts beside the source, in a folder named for it', async () => {
    const file = await write('plugin-tr.po', catalogue(5))
    const summary = await splitPo({ file, size: 2 })

    expect(summary.dir).toBe(join(dir, 'plugin-tr-split'))
    expect(await readdir(summary.dir)).toEqual([
      'plugin-tr-01.po',
      'plugin-tr-02.po',
      'plugin-tr-03.po',
    ])
    expect(summary.parts.map((p) => p.entries)).toEqual([2, 2, 1])
  })

  it('keeps every entry exactly once, in source order', async () => {
    const file = await write('plugin-tr.po', catalogue(7))
    const summary = await splitPo({ file, size: 3 })

    const seen: string[] = []
    for (const part of summary.parts) {
      const parsed = await parsePart(part.file)
      for (const msgid of Object.keys(parsed.translations[''] ?? {})) {
        if (msgid !== '') seen.push(msgid)
      }
    }
    expect(seen).toEqual(Array.from({ length: 7 }, (_, i) => `Source ${i + 1}`))
  })

  // A split changes no translation, so claiming a revision date for it would
  // be a claim about work that did not happen.
  it('carries the source header into every part, unstamped', async () => {
    const file = await write('plugin-tr.po', catalogue(4))
    const summary = await splitPo({ file, size: 2 })

    for (const part of summary.parts) {
      const { headers } = await parsePart(part.file)
      expect(headers['X-Generator']).toBe('GlotPress/4.1.0')
      expect(headers['PO-Revision-Date']).toBe('2026-09-14 09:35+0000')
      expect(headers['Plural-Forms']).toBe('nplurals=2; plural=n > 1;')
    }
  })

  it('preserves comments, references and flags on an entry', async () => {
    const body = `${HEADER}
#. Shown on the settings screen
#: src/admin.php:42
#, fuzzy
msgid "Save Changes"
msgstr "Degisiklikleri Kaydet"

msgid "Other"
msgstr "Diger"
`
    const file = await write('plugin-tr.po', body)
    const summary = await splitPo({ file, size: 1 })
    const parsed = await parsePart(summary.parts[0]!.file)
    const entry = parsed.translations['']!['Save Changes']!
    expect(entry.comments?.extracted).toContain('settings screen')
    expect(entry.comments?.reference).toContain('src/admin.php:42')
    expect(entry.comments?.flag).toContain('fuzzy')
  })

  // gettext-parser holds retired entries in a bucket of their own and re-emits
  // them on compile, so without this they land in all of the parts.
  it('puts obsolete entries in the first part and nowhere else', async () => {
    const file = await write('plugin-tr.po', catalogue(4, '#~ msgid "Retired"\n#~ msgstr "Emekli"\n'))
    const summary = await splitPo({ file, size: 2 })

    const first = await readFile(summary.parts[0]!.file, 'utf8')
    const second = await readFile(summary.parts[1]!.file, 'utf8')
    expect(first).toContain('#~ msgid "Retired"')
    expect(second).not.toContain('#~')
  })

  it('makes one part when the file is smaller than the size asked for', async () => {
    const file = await write('plugin-tr.po', catalogue(3))
    const summary = await splitPo({ file, size: 100 })
    expect(summary.parts).toHaveLength(1)
    expect(summary.parts[0]!.entries).toBe(3)
  })

  describe('the overwrite guard', () => {
    it('refuses when the folder already holds something', async () => {
      const file = await write('plugin-tr.po', catalogue(4))
      await mkdir(join(dir, 'plugin-tr-split'))
      await writeFile(join(dir, 'plugin-tr-split', 'plugin-tr-01.po'), 'mine, edited')

      await expect(splitPo({ file, size: 2 })).rejects.toThrow(UsageError)
      // The refusal must leave what is there alone, or it is the data loss it
      // exists to prevent.
      expect(await readFile(join(dir, 'plugin-tr-split', 'plugin-tr-01.po'), 'utf8')).toBe('mine, edited')
    })

    it('writes into an empty folder that already exists', async () => {
      const file = await write('plugin-tr.po', catalogue(4))
      await mkdir(join(dir, 'plugin-tr-split'))
      const summary = await splitPo({ file, size: 2 })
      expect(summary.parts).toHaveLength(2)
    })

    it('overwrites with force, and reports what it left behind', async () => {
      const file = await write('plugin-tr.po', catalogue(4))
      await mkdir(join(dir, 'plugin-tr-split'))
      await writeFile(join(dir, 'plugin-tr-split', 'plugin-tr-01.po'), 'stale')
      await writeFile(join(dir, 'plugin-tr-split', 'plugin-tr-09.po'), 'stale from a finer split')

      const summary = await splitPo({ file, size: 2, force: true })
      expect(summary.parts).toHaveLength(2)
      expect(await readFile(summary.parts[0]!.file, 'utf8')).toContain('Source 1')
      // A leftover from a previous, finer split is not deleted: it may be work.
      // It is reported so it cannot be uploaded by mistake.
      expect(summary.leftBehind).toEqual(['plugin-tr-09.po'])
    })
  })

  describe('rejecting what cannot be split', () => {
    it('refuses a size below one', async () => {
      const file = await write('plugin-tr.po', catalogue(4))
      await expect(splitPo({ file, size: 0 })).rejects.toThrow(UsageError)
    })

    it('refuses a catalogue with no entries', async () => {
      const file = await write('empty-tr.po', HEADER)
      await expect(splitPo({ file, size: 10 })).rejects.toThrow(/no entries/i)
    })
  })
})
