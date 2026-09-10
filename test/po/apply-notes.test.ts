import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPo } from '../../src/po/po-file.js'

const PO = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Draft"
msgstr ""

#. Keep this note from the source
msgid "Sidebar"
msgstr ""
`

describe('PoFile.apply notes', () => {
  let home: string
  let file: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-apply-notes-'))
    file = join(home, 'sample.po')
    await writeFile(file, PO, 'utf8')
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  async function apply(results: Array<{ key: string; text: string[]; fuzzy: boolean; reason?: string }>) {
    const po = await loadPo(file)
    po.apply(results)
    await po.save()
    return readFile(file, 'utf8')
  }

  it('records why an entry was left fuzzy', async () => {
    const text = await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: true, reason: 'ambiguous: could be a verb' }])
    expect(text).toContain('# polyglots: ambiguous: could be a verb')
    expect(text).toMatch(/#,.*fuzzy/)
  })

  it('leaves a confident translation unannotated', async () => {
    const text = await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: false, reason: 'glossary confirms' }])
    expect(text).not.toContain('polyglots:')
  })

  // translate writes in place and resuming a run is normal, so a second pass must
  // not stack a second copy of the note.
  it('replaces its own note instead of accumulating on a re-run', async () => {
    await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: true, reason: 'first reason' }])
    const text = await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: true, reason: 'second reason' }])

    expect(text).toContain('# polyglots: second reason')
    expect(text).not.toContain('first reason')
    expect(text.match(/polyglots:/g)).toHaveLength(1)
  })

  it('removes its note when the entry stops being fuzzy', async () => {
    await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: true, reason: 'unsure' }])
    const text = await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: false }])
    expect(text).not.toContain('polyglots:')
  })

  it('keeps comments that came from the source file', async () => {
    const text = await apply([{ key: 'Sidebar', text: ['Kenar çubuğu'], fuzzy: true, reason: 'check the glossary' }])
    expect(text).toContain('Keep this note from the source')
    expect(text).toContain('# polyglots: check the glossary')
  })

  it('is a no-op when a fuzzy result carries no reason', async () => {
    const text = await apply([{ key: 'Draft', text: ['Taslak'], fuzzy: true }])
    expect(text).not.toContain('polyglots:')
    expect(text).toMatch(/#,.*fuzzy/)
  })
})
