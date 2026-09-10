import { describe, expect, it } from 'vitest'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'
import { buildRuleContext, runRules } from '../../src/audit/rules/index.js'

const GLOSSARY: GlossaryEntry[] = [
  { locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu', partOfSpeech: 'noun' },
  { locale: 'tr', sourceTerm: 'author', translation: 'yazar', partOfSpeech: 'noun' },
  { locale: 'tr', sourceTerm: 'author', translation: 'geliştirici', partOfSpeech: 'noun' },
  { locale: 'tr', sourceTerm: 'book', translation: 'kitap', partOfSpeech: 'noun' },
]

function entry(msgid: string, msgstr: string | string[], extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    key: msgid,
    msgid,
    msgstr: Array.isArray(msgstr) ? msgstr : [msgstr],
    comments: [],
    references: [],
    fuzzy: false,
    ...extra,
  }
}

function check(e: AuditEntry, all: AuditEntry[] = [e]) {
  const ctx = buildRuleContext({ locale: 'tr', glossary: GLOSSARY, nplurals: 2, entries: all })
  return runRules(e, ctx)
}

const rules = (e: AuditEntry, all?: AuditEntry[]) => check(e, all).map((f) => f.rule)
const severityOf = (e: AuditEntry, rule: string) => check(e).find((f) => f.rule === rule)?.severity

describe('placeholder rule', () => {
  it('flags a dropped placeholder as an error', () => {
    expect(rules(entry('%s comments', 'yorumlar'))).toContain('placeholder')
    expect(severityOf(entry('%s comments', 'yorumlar'), 'placeholder')).toBe('error')
  })

  it('flags an added placeholder the source never had', () => {
    expect(rules(entry('Comments', '%s yorum'))).toContain('placeholder')
  })

  it('accepts placeholders that survive, including positional ones', () => {
    expect(rules(entry('%1$s of %2$s', '%2$s içinde %1$s'))).not.toContain('placeholder')
  })
})

describe('html rule', () => {
  it('flags a dropped tag', () => {
    expect(rules(entry('Read <a href="%s">more</a>', 'Daha fazlasını oku'))).toContain('html')
  })

  it('accepts tags that survive in a different order', () => {
    expect(rules(entry('<strong>Save</strong> now', 'Şimdi <strong>kaydet</strong>'))).not.toContain('html')
  })
})

describe('plural-count rule', () => {
  it('flags a plural entry missing a form', () => {
    const e = entry('%s comment', ['%s yorum'], { msgidPlural: '%s comments' })
    expect(rules(e)).toContain('plural-count')
    expect(severityOf(e, 'plural-count')).toBe('error')
  })

  it('accepts a plural entry with both forms', () => {
    const e = entry('%s comment', ['%s yorum', '%s yorum'], { msgidPlural: '%s comments' })
    expect(rules(e)).not.toContain('plural-count')
  })
})

describe('whitespace rule', () => {
  it('flags a lost trailing space', () => {
    expect(rules(entry('Posted by ', 'Yazan'))).toContain('whitespace')
  })

  it('accepts matching whitespace', () => {
    expect(rules(entry('Posted by ', 'Yazan '))).not.toContain('whitespace')
  })
})

describe('untranslated rule', () => {
  it('flags a translation identical to the source as a suspect', () => {
    expect(rules(entry('Settings', 'Settings'))).toContain('untranslated')
    expect(severityOf(entry('Settings', 'Settings'), 'untranslated')).toBe('suspect')
  })

  it('ignores an empty translation, which is simply unsubmitted', () => {
    expect(rules(entry('Settings', ''))).not.toContain('untranslated')
  })
})

describe('punctuation rule', () => {
  it('flags a lost trailing colon', () => {
    expect(rules(entry('Name:', 'Ad'))).toContain('punctuation')
  })

  it('accepts a preserved ellipsis', () => {
    expect(rules(entry('Loading…', 'Yükleniyor…'))).not.toContain('punctuation')
  })
})

describe('title-case rule', () => {
  it('flags a translation mirroring English title case', () => {
    expect(rules(entry('Save All Changes', 'Tüm Değişiklikleri Kaydet'))).toContain('title-case')
  })

  it('flags a translation that title-cases a sentence-case source', () => {
    expect(rules(entry('Save changes', 'Değişiklikleri Kaydet'))).toContain('title-case')
  })

  it('accepts normal Turkish sentence case', () => {
    expect(rules(entry('Save All Changes', 'Tüm değişiklikleri kaydet'))).not.toContain('title-case')
  })

  it('does not count allowlisted brands as title case', () => {
    expect(rules(entry('WordPress Themes', 'WordPress temaları'))).not.toContain('title-case')
  })

  it('does not count acronyms', () => {
    expect(rules(entry('Export CSV', 'CSV dışa aktar'))).not.toContain('title-case')
  })

  it('treats a mid-sentence capital in a sentence-case source as a proper noun', () => {
    expect(rules(entry('Connect your Google Analytics account', 'Google Analytics hesabınızı bağlayın'))).not.toContain(
      'title-case',
    )
  })

  it('does not flag a single-word translation', () => {
    expect(rules(entry('Settings', 'Ayarlar'))).not.toContain('title-case')
  })
})

describe('glossary rule', () => {
  it('flags a translation ignoring the approved term', () => {
    const e = entry('Sidebar', 'Yan menü')
    expect(rules(e)).toContain('glossary')
    expect(severityOf(e, 'glossary')).toBe('suspect')
  })

  it('accepts the approved term carrying a Turkish suffix', () => {
    expect(rules(entry('Open the sidebar', 'Kenar çubuğunu aç'))).not.toContain('glossary')
  })

  it('accepts any of several approved alternatives', () => {
    expect(rules(entry('Author', 'Geliştirici'))).not.toContain('glossary')
    expect(rules(entry('Author', 'Yazar'))).not.toContain('glossary')
  })

  it('only fires when the source actually contains the term', () => {
    expect(rules(entry('Settings', 'Ayarlar'))).not.toContain('glossary')
  })

  it('matches the term on a word boundary, not inside another word', () => {
    expect(rules(entry('Bookmark this', 'Bunu işaretle'))).not.toContain('glossary')
  })
})

describe('apostrophe rule', () => {
  it('flags a suffix attached to a brand without an apostrophe', () => {
    expect(rules(entry('Update WordPress', 'WordPressi güncelle'))).toContain('apostrophe')
  })

  it('accepts the apostrophe form', () => {
    expect(rules(entry('Update WordPress', "WordPress'i güncelle"))).not.toContain('apostrophe')
  })

  it('accepts a brand with no suffix at all', () => {
    expect(rules(entry('Update WordPress', 'WordPress güncelle'))).not.toContain('apostrophe')
  })
})

describe('inconsistent rule', () => {
  it('flags the same source translated two different ways in one file', () => {
    const a = entry('Save', 'Kaydet')
    const b = { ...entry('Save', 'Sakla'), key: 'ctxSave', msgctxt: 'ctx' }
    expect(rules(a, [a, b])).toContain('inconsistent')
    expect(rules(b, [a, b])).toContain('inconsistent')
  })

  it('accepts consistent repeats', () => {
    const a = entry('Save', 'Kaydet')
    const b = { ...entry('Save', 'Kaydet'), key: 'ctxSave', msgctxt: 'ctx' }
    expect(rules(a, [a, b])).not.toContain('inconsistent')
  })
})

describe('runRules', () => {
  it('returns no findings for a clean translation', () => {
    expect(check(entry('Save all changes', 'Tüm değişiklikleri kaydet'))).toEqual([])
  })

  it('returns every finding that applies, each with a human-readable message', () => {
    const found = check(entry('Save All %s Changes', 'Tüm Değişiklikleri Kaydet'))
    expect(found.map((f) => f.rule).sort()).toEqual(['placeholder', 'title-case'])
    for (const f of found) expect(f.message.length).toBeGreaterThan(0)
  })
})
