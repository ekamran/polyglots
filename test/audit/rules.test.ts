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

describe('title-case rule, Turkish capitalization categories', () => {
  it('does not flag a word starting a new sentence', () => {
    expect(rules(entry('It failed. Contact support.', 'Bir şey oldu. Ayrıntılar için destek ile görüşün.'))).not.toContain(
      'title-case',
    )
  })

  it('does not flag a word after a colon or question mark', () => {
    expect(rules(entry('Note: check your settings', 'Not: Ayarlarınızı kontrol edin'))).not.toContain('title-case')
    expect(rules(entry('Ready? Start now', 'Hazır mısınız? Şimdi başlayın'))).not.toContain('title-case')
  })

  it('does not flag an acronym carrying a Turkish suffix', () => {
    expect(rules(entry('Download the PDF now', "Şimdi PDF'yi indir"))).not.toContain('title-case')
    expect(rules(entry('Copy the URL', "Bağlantı URL'sini kopyala"))).not.toContain('title-case')
  })

  it('does not flag language and nationality names, which Turkish capitalizes', () => {
    expect(rules(entry('Set the language to English', 'Uygulama dilini İngilizce yap'))).not.toContain('title-case')
    expect(rules(entry('Turkish users', 'Türk kullanıcılar'))).not.toContain('title-case')
  })

  it('does not flag a day or month name in a specific date', () => {
    expect(rules(entry('Expires on 12 May', '12 Mayıs tarihinde sona erer'))).not.toContain('title-case')
    expect(rules(entry('Conquest of Istanbul', '29 Mayıs 1453 Salı günü fetih'))).not.toContain('title-case')
    expect(rules(entry('Starts on 25 June', 'Festival 25 Haziran\'da başlayacak'))).not.toContain('title-case')
  })

  // TDK madde Ç capitalizes a day or month name only in a specific date and keeps
  // it lowercase in generic use, so a capital without a date is a real error.
  it('flags a capitalized day or month name outside a specific date', () => {
    expect(rules(entry('Every Monday', 'Her Pazartesi'))).toContain('title-case')
    expect(rules(entry('We meet on Thursdays', 'Toplantıları Perşembe günleri yaparız'))).toContain('title-case')
    expect(rules(entry('Schools open in September', 'Okullar Eylülde açılır'))).toContain('title-case')
  })

  it('treats a placeholder next to a month name as the date number', () => {
    expect(rules(entry('Expires on %s May', '%s Mayıs tarihinde sona erer'))).not.toContain('title-case')
    expect(rules(entry('Expires %1$s %2$s', 'Mayıs %1$s tarihinde'))).not.toContain('title-case')
  })

  // A placeholder used to vanish before tokenizing, which made the word after it
  // look sentence-initial and hid a real mid-string capital.
  it('does not let a leading placeholder hide a capitalized word', () => {
    expect(rules(entry('Save %s', '%s Kaydet'))).toContain('title-case')
    expect(rules(entry('%s comments', '%s Yorum'))).toContain('title-case')
  })

  it('keeps language and nation names exempt regardless of any date context', () => {
    expect(rules(entry('Turkish users', 'Her gün Türk kullanıcılar'))).not.toContain('title-case')
  })

  it('still flags a genuine calque of English title case', () => {
    expect(rules(entry('Save All Changes', 'Tüm Değişiklikleri Kaydet'))).toContain('title-case')
  })

  it('still flags a capitalized ordinary word mid-sentence', () => {
    expect(rules(entry('Save changes', 'Değişiklikleri Kaydet'))).toContain('title-case')
  })
})

describe('title-case rule, user-supplied proper nouns', () => {
  function withNouns(msgid: string, msgstr: string, properNouns: string[]) {
    const e = entry(msgid, msgstr)
    const ctx = buildRuleContext({ locale: 'tr', glossary: GLOSSARY, nplurals: 2, entries: [e], properNouns })
    return runRules(e, ctx).map((f) => f.rule)
  }

  it('exempts a single-word name the user supplied', () => {
    expect(withNouns('Server in Izmir', 'Sunucu İzmir konumunda', ['İzmir'])).not.toContain('title-case')
  })

  // TDK capitalizes every word of an institution name, so a correct one looks
  // exactly like an English title-case calque unless it is matched as a phrase.
  it('exempts every word of a multi-word institution name', () => {
    expect(withNouns('Approved by TDK', 'Türk Dil Kurumu tarafından onaylandı', ['Türk Dil Kurumu'])).not.toContain(
      'title-case',
    )
  })

  it('exempts a phrase whose last word carries a Turkish suffix', () => {
    expect(withNouns('TDK decision', 'Türk Dil Kurumu\'nun kararı', ['Türk Dil Kurumu'])).not.toContain('title-case')
  })

  it('does not exempt a phrase word used on its own', () => {
    expect(withNouns('Language settings', 'Dil Ayarları', ['Türk Dil Kurumu'])).toContain('title-case')
  })

  it('matches the phrase case-insensitively in Turkish', () => {
    expect(withNouns('Historic event', 'Bu Kurtuluş Savaşı dönemidir', ['kurtuluş savaşı'])).not.toContain('title-case')
  })

  it('still flags an ordinary calque when a name list is present', () => {
    expect(withNouns('Save All Changes', 'Tüm Değişiklikleri Kaydet', ['İzmir'])).toContain('title-case')
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
