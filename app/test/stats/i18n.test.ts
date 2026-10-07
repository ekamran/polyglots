import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { embedTranslations, render } from '../../scripts/stats-i18n.mjs'
import { ALL_NOTES, ALL_PHRASES, ENGLISH, NOTES, PHRASES, negotiate, percent, ruleText, type StatsLanguage } from '../../src/stats/i18n.js'
import { renderPot } from '../../src/stats/pot.js'
import { STATS_TRANSLATIONS } from '../../src/stats/translations-data.js'

const DIR = join(import.meta.dirname, '..', '..', 'i18n', 'stats')
const read = (name: string) => readFileSync(join(DIR, name), 'utf8')

const POT = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgctxt "title"
msgid "Review statistics"
msgstr ""

msgctxt "peak"
msgid "peak"
msgstr ""
`

const po = (language: string, body: string) => `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: ${language}\\n"

${body}`

describe('the stats template', () => {
  // The English lives in code, where the renderer reads it; the template is
  // what translators get. A string added to one and not the other is a string
  // nobody can translate.
  it('is current with the phrases in code', () => {
    expect(read('stats.pot')).toBe(renderPot(ALL_PHRASES, ALL_NOTES))
  })

  it('names each string by its key and carries the note for translators', () => {
    const pot = renderPot(PHRASES, NOTES)
    expect(pot).toContain('msgctxt "title"\nmsgid "Review statistics"\nmsgstr ""')
    expect(pot).toMatch(/#\. .*\{n\}.*\nmsgctxt "durationSeconds"/)
  })
})

describe('embedTranslations', () => {
  it('takes each translated string by its key, with the language from the header', () => {
    const out = embedTranslations(POT, [
      { name: 'de_DE.po', text: po('de', 'msgctxt "title"\nmsgid "Review statistics"\nmsgstr "Prüfstatistik"\n') },
    ])
    expect(out).toEqual([{ tag: 'de', phrases: { title: 'Prüfstatistik' } }])
  })

  it('falls back to the file name when the header has no language', () => {
    const out = embedTranslations(POT, [{ name: 'pt_BR.po', text: po('', 'msgctxt "peak"\nmsgid "peak"\nmsgstr "pico"\n') }])
    expect(out[0]?.tag).toBe('pt-BR')
  })

  // English is the fallback, so an unsure, empty or outdated translation is
  // better left out than shown.
  it('leaves out fuzzy, empty and outdated strings, and keys the template does not have', () => {
    const out = embedTranslations(POT, [
      {
        name: 'de.po',
        text: po(
          'de',
          [
            '#, fuzzy\nmsgctxt "title"\nmsgid "Review statistics"\nmsgstr "Statistik"\n',
            'msgctxt "peak"\nmsgid "highest"\nmsgstr "Spitze"\n',
            'msgctxt "gone"\nmsgid "gone"\nmsgstr "weg"\n',
          ].join('\n'),
        ),
      },
    ])
    expect(out).toEqual([{ tag: 'de', phrases: {} }])
  })

  it('refuses a language tag that is not safe to put in the page', () => {
    expect(() => embedTranslations(POT, [{ name: 'x.po', text: po('de><script>', '') }])).toThrow(/language/)
  })

  it('orders languages by tag, so the generated file is stable', () => {
    const out = embedTranslations(POT, [
      { name: 'tr.po', text: po('tr', '') },
      { name: 'de.po', text: po('de', '') },
    ])
    expect(out.map((l: { tag: string }) => l.tag)).toEqual(['de', 'tr'])
  })
})

describe('the embedded translations', () => {
  it('are current with the .po files in i18n/stats', () => {
    const files = ['tr_TR.po'].map((name) => ({ name, text: read(name) }))
    expect(render(embedTranslations(read('stats.pot'), files))).toBe(
      readFileSync(join(import.meta.dirname, '..', '..', 'src', 'stats', 'translations-data.ts'), 'utf8'),
    )
  })

  it('carry the whole Turkish page', () => {
    const tr = STATS_TRANSLATIONS.find((l) => l.tag === 'tr')
    expect(Object.keys(tr?.phrases ?? {}).sort()).toEqual(Object.keys(ALL_PHRASES).sort())
  })
})

describe('rule names in the template', () => {
  it('carry a name and a description for every finding key, with a note', () => {
    const pot = renderPot(ALL_PHRASES, ALL_NOTES)
    expect(pot).toContain('msgctxt "rule:ai:register"\nmsgid "Tone and formality (AI)"')
    expect(pot).toContain('msgctxt "rule:ampersand:desc"')
    expect(pot).toMatch(/#\. .*"ampersand".*\nmsgctxt "rule:ampersand"/)
  })
})

describe('ruleText', () => {
  const tr: StatsLanguage = { tag: 'tr', phrases: { 'rule:ampersand': 'Ve işareti' } }

  it('takes the translation when there is one and the English otherwise', () => {
    expect(ruleText('ampersand', tr).name).toBe('Ve işareti')
    expect(ruleText('ampersand', tr).description).toMatch(/conjunction/)
  })

  it('shows a key with no label as itself, so the legend still adds up', () => {
    expect(ruleText('retired-rule', ENGLISH)).toEqual({ name: 'retired-rule', description: '' })
  })
})

describe('negotiate', () => {
  const langs: StatsLanguage[] = [
    { tag: 'tr', phrases: {} },
    { tag: 'pt-BR', phrases: {} },
  ]

  it('matches a regional tag to the language by its primary subtag', () => {
    expect(negotiate('tr-TR,tr;q=0.9,en;q=0.8', langs).tag).toBe('tr')
  })

  it('follows q weights rather than order', () => {
    expect(negotiate('en;q=0.5,tr;q=0.9', langs).tag).toBe('tr')
  })

  it('prefers an exact regional match', () => {
    expect(negotiate('pt-br', langs).tag).toBe('pt-BR')
  })

  it('falls back to English for a missing header or nothing it carries', () => {
    expect(negotiate(undefined, langs)).toBe(ENGLISH)
    expect(negotiate('ja,ko;q=0.5', langs)).toBe(ENGLISH)
  })

  it('ignores a language the reader refused with q=0', () => {
    expect(negotiate('tr;q=0,en', langs)).toBe(ENGLISH)
  })
})

describe('percent', () => {
  it('follows the language, which puts the sign first in Turkish', () => {
    expect(percent(0.12, ENGLISH)).toBe('12%')
    expect(percent(0.12, { tag: 'tr', phrases: {} })).toBe('%12')
  })
})
