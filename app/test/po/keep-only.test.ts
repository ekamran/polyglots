import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPo, unitKey, type Annotation } from '../../src/po/po-file.js'

const PO = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

#. from the source code
#: admin.php:12
msgid "Settings"
msgstr "Ayarlar"

msgctxt "post status"
msgid "Draft"
msgstr "Taslak"

#, php-format
msgid "%s comments"
msgstr "yorumlar"

#, fuzzy
msgid "Arrived fuzzy"
msgstr "Bulanık geldi"
`

describe('PoFile.keepOnly', () => {
  let home: string
  let file: string
  let out: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-keep-only-'))
    file = join(home, 'sample.po')
    out = join(home, 'sample-problems.po')
    await writeFile(file, PO, 'utf8')
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  async function keep(annotations: Map<string, Annotation>): Promise<string> {
    const po = await loadPo(file)
    po.keepOnly(annotations)
    await po.save(out)
    return readFile(out, 'utf8')
  }

  it('drops every entry that was not kept', async () => {
    const text = await keep(new Map([['Settings', { notes: ['title case'] }]]))
    expect(text).toContain('msgid "Settings"')
    expect(text).not.toContain('msgid "Draft"')
    expect(text).not.toContain('msgid "%s comments"')
  })

  /**
   * Every entry in this file is already there because something was wrong with
   * it, so a flag on all of them says nothing the file does not. It cost the
   * reviewer a step, too: their way of working is to select all, clear the
   * flags, read from the top, and mark the one entry they stopped at so they
   * can find it again. A file that arrives entirely fuzzy erases that.
   *
   * It was there for a pipeline that no longer exists. The flag was added in
   * the first review commit, when review only flagged and wrote no fixes, so
   * the file was a worklist and `translate` picked it up by selecting fuzzy
   * entries. Review learned to repair later; re-drafting its repairs with a
   * machine engine would throw away the better answer.
   */
  it('marks an entry nobody could fix, so the work left to do is findable', async () => {
    const text = await keep(new Map([['Settings', { notes: ['title case'] }]]))
    expect(text).toMatch(/#,\s*fuzzy/)
    expect(text).toContain('msgstr "Ayarlar"')
  })

  // The other kind: a correction is already in the entry, so there is nothing
  // to go and write. Marking these too would flag the whole file again.
  it('leaves a repaired entry unflagged, since its text is the repair', async () => {
    const text = await keep(new Map([['Settings', { notes: ['title case'], text: ['Ayarlar düzeltildi'] }]]))
    expect(text).not.toMatch(/#,\s*fuzzy/)
    expect(text).toContain('msgstr "Ayarlar düzeltildi"')
  })

  // Not adding one is not the same as taking one away: a submission that was
  // already fuzzy says so, and that is the contributor's state to report.
  it('leaves a flag the entry arrived with alone', async () => {
    const text = await keep(new Map([['Arrived fuzzy', { notes: ['meaning'] }]]))
    expect(text).toMatch(/#,\s*fuzzy/)
  })

  it('writes each annotation as a translator comment', async () => {
    const text = await keep(
      new Map([['Settings', { notes: ['title case mirrors the source', 'glossary term not used'] }]]),
    )
    expect(text).toContain('# polyglots: title case mirrors the source')
    expect(text).toContain('# polyglots: glossary term not used')
  })

  it('keeps the flags an entry already had', async () => {
    const text = await keep(new Map([['%s comments', { notes: ['placeholder missing'], text: ['%s yorum'] }]]))
    expect(text).toMatch(/#,.*php-format/)
    expect(text).not.toMatch(/#,.*fuzzy/)
  })

  it('keeps a context-qualified entry by its key', async () => {
    const text = await keep(new Map([[unitKey('Draft', 'post status'), { notes: ['meaning'] }]]))
    expect(text).toContain('msgctxt "post status"')
    expect(text).toContain('msgid "Draft"')
    expect(text).not.toContain('msgid "Settings"')
  })

  it('preserves the header so the result is a valid po file', async () => {
    const text = await keep(new Map([['Settings', { notes: ['x'] }]]))
    expect(text).toContain('Plural-Forms: nplurals=2')
    const reparsed = await loadPo(out)
    expect(reparsed.auditEntries().map((e) => e.key)).toEqual(['Settings'])
  })

  it('writes a repaired translation in place of the submitted one', async () => {
    const text = await keep(new Map([['Settings', { notes: ['glossary'], text: ['Ayarlar bölümü'] }]]))
    expect(text).toContain('msgstr "Ayarlar bölümü"')
    expect(text).not.toContain('msgstr "Ayarlar"')
  })

  it('leaves the submitted translation alone when there is no repair', async () => {
    const text = await keep(new Map([['Settings', { notes: ['glossary'] }]]))
    expect(text).toContain('msgstr "Ayarlar"')
  })

  // An entry kept with no note of its own must still say something, so a human
  // opening the file can tell why it was flagged at all.
  it('writes a note even for an annotation that came with none', async () => {
    const text = await keep(new Map([['Settings', { notes: [] }]]))
    expect(text).toContain('# polyglots: flagged for review')
  })

  // The note text on the audit path is the model's own reason string, so a
  // reply that begins with a newline lands here. splitLines trims every line,
  // so without flattening, the note would be written as a bare "# polyglots:"
  // followed by an unprefixed continuation line.
  it('flattens a note that begins with a newline into a single comment line', async () => {
    const text = await keep(new Map([['Settings', { notes: ['\nglossary term not used'], text: ['Ayarlar bölümü'] }]]))
    expect(text).toContain('# polyglots: glossary term not used')
    expect(text).toContain('msgstr "Ayarlar bölümü"')
  })

  // A newline inside the note would otherwise split it across two comment
  // lines, only the first of which carries the prefix, silently losing the
  // rest.
  it('flattens a note with a newline inside it into one comment line', async () => {
    const text = await keep(new Map([['Settings', { notes: ['title case mirrors the source\nand the glossary term is not used'] }]]))
    expect(text).toContain('# polyglots: title case mirrors the source and the glossary term is not used')
  })

  it('leaves the submitted translation alone when the repair is an empty list', async () => {
    const text = await keep(new Map([['Settings', { notes: ['glossary'], text: [] }]]))
    expect(text).toContain('msgstr "Ayarlar"')
  })
})
