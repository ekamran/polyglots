import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPo, unitKey } from '../../src/po/po-file.js'

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

  async function keep(annotations: Map<string, string[]>): Promise<string> {
    const po = await loadPo(file)
    po.keepOnly(annotations)
    await po.save(out)
    return readFile(out, 'utf8')
  }

  it('drops every entry that was not kept', async () => {
    const text = await keep(new Map([['Settings', ['title case']]]))
    expect(text).toContain('msgid "Settings"')
    expect(text).not.toContain('msgid "Draft"')
    expect(text).not.toContain('msgid "%s comments"')
  })

  it('marks kept entries fuzzy and preserves the submitted translation', async () => {
    const text = await keep(new Map([['Settings', ['title case']]]))
    expect(text).toMatch(/#,\s*fuzzy/)
    expect(text).toContain('msgstr "Ayarlar"')
  })

  it('writes each annotation as a translator comment', async () => {
    const text = await keep(new Map([['Settings', ['title case mirrors the source', 'glossary term not used']]]))
    expect(text).toContain('# polyglots: title case mirrors the source')
    expect(text).toContain('# polyglots: glossary term not used')
  })

  it('keeps existing flags alongside fuzzy', async () => {
    const text = await keep(new Map([['%s comments', ['placeholder missing']]]))
    expect(text).toMatch(/#,.*php-format/)
    expect(text).toMatch(/#,.*fuzzy/)
  })

  it('keeps a context-qualified entry by its key', async () => {
    const text = await keep(new Map([[unitKey('Draft', 'post status'), ['meaning']]]))
    expect(text).toContain('msgctxt "post status"')
    expect(text).toContain('msgid "Draft"')
    expect(text).not.toContain('msgid "Settings"')
  })

  it('preserves the header so the result is a valid po file', async () => {
    const text = await keep(new Map([['Settings', ['x']]]))
    expect(text).toContain('Plural-Forms: nplurals=2')
    const reparsed = await loadPo(out)
    expect(reparsed.auditEntries().map((e) => e.key)).toEqual(['Settings'])
  })
})
