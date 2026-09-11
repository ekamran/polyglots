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

  it('marks kept entries fuzzy and preserves the submitted translation', async () => {
    const text = await keep(new Map([['Settings', { notes: ['title case'] }]]))
    expect(text).toMatch(/#,\s*fuzzy/)
    expect(text).toContain('msgstr "Ayarlar"')
  })

  it('writes each annotation as a translator comment', async () => {
    const text = await keep(
      new Map([['Settings', { notes: ['title case mirrors the source', 'glossary term not used'] }]]),
    )
    expect(text).toContain('# polyglots: title case mirrors the source')
    expect(text).toContain('# polyglots: glossary term not used')
  })

  it('keeps existing flags alongside fuzzy', async () => {
    const text = await keep(new Map([['%s comments', { notes: ['placeholder missing'] }]]))
    expect(text).toMatch(/#,.*php-format/)
    expect(text).toMatch(/#,.*fuzzy/)
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

  // Resume rebuilds the output from the source file, so the repaired text has to
  // come back out of the file the interrupted run wrote or it silently reverts.
  it('reads back both its notes and the text it wrote', async () => {
    await keep(new Map([['Settings', { notes: ['glossary term not used'], text: ['Ayarlar bölümü'] }]]))
    const reparsed = await loadPo(out)
    expect(reparsed.carried()).toEqual(
      new Map([['Settings', { notes: ['glossary term not used'], msgstr: ['Ayarlar bölümü'] }]]),
    )
  })

  // The key a context-qualified entry reads back under is msgctxt + U+0004 +
  // msgid, which is the one shape a round trip can quietly get wrong.
  it('reads back a context-qualified entry under the key it was written with', async () => {
    const key = unitKey('Draft', 'post status')
    await keep(new Map([[key, { notes: ['meaning'], text: ['Müsvedde'] }]]))
    const reparsed = await loadPo(out)
    expect(reparsed.carried()).toEqual(new Map([[key, { notes: ['meaning'], msgstr: ['Müsvedde'] }]]))
  })

  // carried() can only see an entry that carries one of our notes, so an
  // annotation written without one would be dropped the next time the output is
  // rebuilt from the source, taking any repair in it along.
  it('writes a note even for an annotation that came with none', async () => {
    await keep(new Map([['Settings', { notes: [] }]]))
    const reparsed = await loadPo(out)
    expect([...reparsed.carried().keys()]).toEqual(['Settings'])
  })

  it('leaves the submitted translation alone when the repair is an empty list', async () => {
    const text = await keep(new Map([['Settings', { notes: ['glossary'], text: [] }]]))
    expect(text).toContain('msgstr "Ayarlar"')
  })

  it('reads back nothing from a file with none of our notes', async () => {
    expect((await loadPo(file)).carried().size).toBe(0)
  })
})
