import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countEntries } from '../../src/po/count.js'

let root: string

const catalogue = (entries: string[]): string =>
  ['msgid ""', 'msgstr ""', '"Project-Id-Version: Test\\n"', ''].concat(entries).join('\n')

const entry = (id: string, str = ''): string => `msgid "${id}"\nmsgstr "${str}"\n`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'polyglots-count-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('countEntries', () => {
  it('counts translatable entries and never the header', async () => {
    const file = join(root, 'a.po')
    await writeFile(file, catalogue([entry('One'), entry('Two'), entry('Three')]))
    expect(countEntries(file)).toBe(3)
  })

  it('counts a catalogue with no entries as zero', async () => {
    const file = join(root, 'empty.po')
    await writeFile(file, catalogue([]))
    expect(countEntries(file)).toBe(0)
  })

  // A plural entry is one entry. msgid_plural opens no new one, and counting it
  // would overstate every file that has plurals in it.
  it('counts a plural entry once', async () => {
    const file = join(root, 'plural.po')
    await writeFile(
      file,
      catalogue(['msgid "%d item"\nmsgid_plural "%d items"\nmsgstr[0] ""\nmsgstr[1] ""\n', entry('Other')]),
    )
    expect(countEntries(file)).toBe(2)
  })

  // GlotPress keeps retired strings in the file commented out. A run never looks
  // at them, so a count that included them would not match what review reports.
  it('ignores obsolete entries', async () => {
    const file = join(root, 'obsolete.po')
    await writeFile(file, catalogue([entry('Live'), '#~ msgid "Dead"\n#~ msgstr ""\n']))
    expect(countEntries(file)).toBe(1)
  })

  it('counts a file that has no header', async () => {
    const file = join(root, 'headerless.po')
    await writeFile(file, [entry('One'), entry('Two')].join('\n'))
    expect(countEntries(file)).toBe(2)
  })

  it('returns undefined for a file that is not a catalogue', async () => {
    const file = join(root, 'memory.tmx')
    await writeFile(file, '<tmx></tmx>')
    expect(countEntries(file)).toBeUndefined()
  })

  it('returns undefined rather than throwing when the file is gone', () => {
    expect(countEntries(join(root, 'missing.po'))).toBeUndefined()
  })

  it('counts .pot templates too', async () => {
    const file = join(root, 'plugin.pot')
    await writeFile(file, catalogue([entry('One')]))
    expect(countEntries(file)).toBe(1)
  })

  // The picker re-reads its directory on every sort change, so the count is
  // cached; a file rewritten in place must still report its new size.
  it('recounts a file after it changes', async () => {
    const file = join(root, 'changing.po')
    await writeFile(file, catalogue([entry('One')]))
    expect(countEntries(file)).toBe(1)
    await writeFile(file, catalogue([entry('One'), entry('Two')]))
    const later = new Date(Date.now() + 2000)
    await utimes(file, later, later)
    expect(countEntries(file)).toBe(2)
  })
})
