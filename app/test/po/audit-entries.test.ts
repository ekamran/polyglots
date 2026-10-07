import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPo, unitKey } from '../../src/po/po-file.js'

const PO = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Settings"
msgstr "Ayarlar"

msgctxt "post status"
msgid "Draft"
msgstr "Taslak"

#, fuzzy
msgid "Sidebar"
msgstr "Yan Menü"

msgid "%s comment"
msgid_plural "%s comments"
msgstr[0] "%s yorum"
msgstr[1] "%s yorum"

msgid "Never submitted"
msgstr ""
`

describe('PoFile.auditEntries', () => {
  let home: string
  let file: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-audit-entries-'))
    file = join(home, 'sample.po')
    await writeFile(file, PO, 'utf8')
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('exposes the submitted translation alongside the source', async () => {
    const po = await loadPo(file)
    const entries = po.auditEntries()

    expect(entries.map((e) => e.key)).toEqual([
      'Settings',
      unitKey('Draft', 'post status'),
      'Sidebar',
      '%s comment',
      'Never submitted',
    ])
    expect(entries[0]).toMatchObject({ msgid: 'Settings', msgstr: ['Ayarlar'], fuzzy: false })
  })

  it('carries msgctxt, plural forms and the fuzzy flag', async () => {
    const entries = (await loadPo(file)).auditEntries()
    const byKey = new Map(entries.map((e) => [e.key, e]))

    expect(byKey.get(unitKey('Draft', 'post status'))).toMatchObject({ msgctxt: 'post status', msgid: 'Draft' })
    expect(byKey.get('Sidebar')?.fuzzy).toBe(true)
    expect(byKey.get('%s comment')).toMatchObject({
      msgidPlural: '%s comments',
      msgstr: ['%s yorum', '%s yorum'],
    })
  })

  it('reports an unsubmitted entry with an empty msgstr rather than dropping it', async () => {
    const entries = (await loadPo(file)).auditEntries()
    expect(entries.find((e) => e.key === 'Never submitted')?.msgstr).toEqual([''])
  })
})
