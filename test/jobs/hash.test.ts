import { describe, expect, it } from 'vitest'
import {
  auditSrcHash,
  configHash,
  draftConfigHash,
  draftHash,
  draftSrcHash,
  srcHash,
  translateConfigHash,
} from '../../src/jobs/hash.js'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  key: 'Save',
  msgid: 'Save',
  msgstr: ['Kaydet'],
  comments: [],
  references: [],
  fuzzy: false,
  ...over,
})

const term = (sourceTerm: string, translation: string): GlossaryEntry => ({
  sourceTerm,
  translation,
  locale: 'tr',
})

const config = (glossary: GlossaryEntry[], properNouns: string[] = []) => ({
  locale: 'tr' as const,
  glossary,
  properNouns,
})

describe('srcHash', () => {
  it('is stable for the same entry', () => {
    expect(srcHash(entry())).toBe(srcHash(entry()))
  })

  it('is 16 hex characters, matching the existing fingerprint format', () => {
    expect(srcHash(entry())).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when the translation changes', () => {
    expect(srcHash(entry({ msgstr: ['Kaydet'] }))).not.toBe(srcHash(entry({ msgstr: ['Sakla'] })))
  })

  it('changes when the source changes', () => {
    expect(srcHash(entry({ msgid: 'Save' }))).not.toBe(srcHash(entry({ msgid: 'Store' })))
  })

  it('separates context from source, so concatenation cannot collide', () => {
    const a = entry({ msgid: 'ab', msgctxt: 'c' })
    const b = entry({ msgid: 'a', msgctxt: 'bc' })
    expect(srcHash(a)).not.toBe(srcHash(b))
  })

  it('covers every plural form, not just the first', () => {
    const a = entry({ msgidPlural: '%d items', msgstr: ['%d oge', '%d oge'] })
    const b = entry({ msgidPlural: '%d items', msgstr: ['%d oge', '%d ogeler'] })
    expect(srcHash(a)).not.toBe(srcHash(b))
  })

  it('covers the text alone: everything the prompt adds belongs to its own hash', () => {
    // Narrow on purpose. A caller that needs the comments or the references in
    // the key asks auditSrcHash or draftSrcHash for them, and says so in the
    // call. Passing a whole entry here hashes four fields and no more.
    expect(srcHash(entry({ comments: [] }))).toBe(srcHash(entry({ comments: ['translators: a note'] })))
  })
})

const context = (over: Partial<Parameters<typeof auditSrcHash>[1]> = {}) => ({
  references: ['admin/menu.php:12'],
  comments: [],
  rules: [],
  nplurals: 2,
  ...over,
})

describe('auditSrcHash', () => {
  it('is stable for the same entry in the same context', () => {
    expect(auditSrcHash(entry(), context())).toBe(auditSrcHash(entry(), context()))
  })

  it('changes when the references change, which is what says what the string is for', () => {
    expect(auditSrcHash(entry(), context())).not.toBe(
      auditSrcHash(entry(), context({ references: ['help/intro.php:3'] })),
    )
  })

  it('changes when the comments change, gettext\'s own disambiguation', () => {
    expect(auditSrcHash(entry(), context())).not.toBe(
      auditSrcHash(entry(), context({ comments: ['translators: a verb'] })),
    )
  })

  it('changes when a rule fires that did not fire before', () => {
    // The rule findings are file-dependent: the rule context learns brands and
    // prior translations from every other entry in the same file.
    expect(auditSrcHash(entry(), context())).not.toBe(auditSrcHash(entry(), context({ rules: ['title-case'] })))
  })

  it('does not change when the same rules fire in another order', () => {
    // Hint order is an implementation detail of the rule list. A spurious miss
    // here would re-ask the model for nothing.
    expect(auditSrcHash(entry(), context({ rules: ['glossary', 'title-case'] }))).toBe(
      auditSrcHash(entry(), context({ rules: ['title-case', 'glossary'] })),
    )
  })

  it('changes when nplurals changes, which the prompt states outright', () => {
    expect(auditSrcHash(entry(), context())).not.toBe(auditSrcHash(entry(), context({ nplurals: 6 })))
  })

  it('still changes when the entry itself changes', () => {
    expect(auditSrcHash(entry(), context())).not.toBe(auditSrcHash(entry({ msgstr: ['Sakla'] }), context()))
  })
})

describe('draftSrcHash', () => {
  const source = { msgid: 'Save', msgstr: [] as string[] }

  it('changes when the comments change, which the draft prompt is told to use', () => {
    expect(draftSrcHash(source, { comments: [], nplurals: 2 })).not.toBe(
      draftSrcHash(source, { comments: ['translators: a verb'], nplurals: 2 }),
    )
  })

  it('changes when nplurals changes, which decides how many drafts are asked for', () => {
    expect(draftSrcHash(source, { comments: [], nplurals: 2 })).not.toBe(
      draftSrcHash(source, { comments: [], nplurals: 6 }),
    )
  })
})

describe('draftConfigHash', () => {
  it('is stable for a locale', () => {
    expect(draftConfigHash('tr')).toBe(draftConfigHash('tr'))
  })

  it('differs per locale, since the prompt names the target language', () => {
    expect(draftConfigHash('tr')).not.toBe(draftConfigHash('de'))
  })

  it('differs from the draft review prompt, which is why the two tables prune separately', () => {
    expect(draftConfigHash('tr')).not.toBe(translateConfigHash('tr'))
  })
})

describe('configHash', () => {
  it('is stable for the same configuration', () => {
    const g = [term('Settings', 'Ayarlar')]
    expect(configHash(config(g))).toBe(configHash(config(g)))
  })

  it('changes when a glossary term changes', () => {
    expect(configHash(config([term('ID', 'kimlik')]))).not.toBe(configHash(config([term('ID', 'ID')])))
  })

  it('changes when the proper noun list changes', () => {
    expect(configHash(config([], []))).not.toBe(configHash(config([], ['WooCommerce'])))
  })

  it('does not depend on the entries being reviewed', () => {
    // Only the entry's own src_hash may vary per entry; config_hash is per run.
    const g = [term('Settings', 'Ayarlar')]
    expect(configHash(config(g))).toBe(configHash(config(g)))
  })
})

describe('translateConfigHash', () => {
  it('is stable, and does not depend on the glossary the audit prompt uses', () => {
    expect(translateConfigHash('tr')).toBe(translateConfigHash('tr'))
  })

  it('differs from the audit configuration hash, which is why they prune separately', () => {
    expect(translateConfigHash('tr')).not.toBe(configHash(config([term('ID', 'kimlik')])))
  })
})

describe('draftHash', () => {
  it('changes with the draft text', () => {
    expect(draftHash(['Kaydet'])).not.toBe(draftHash(['Sakla']))
  })

  it('covers every plural form', () => {
    expect(draftHash(['a', 'b'])).not.toBe(draftHash(['a', 'c']))
  })
})
