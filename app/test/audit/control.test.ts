import { describe, expect, it } from 'vitest'
import { controlSpec } from '../../src/audit/control.js'
import { buildRuleContext, runRules } from '../../src/audit/rules/index.js'
import { buildAuditPrompt } from '../../src/audit/prompt.js'
import { buildReviewPrompt } from '../../src/review/prompt.js'

// Each shaped exactly as the WordPress core export carries it.
const unit = (msgid: string, msgctxt: string | undefined, ...comments: string[]) => ({
  key: `${msgctxt ?? ''}${msgid}`,
  msgid,
  ...(msgctxt === undefined ? {} : { msgctxt }),
  comments,
  references: [],
})

const OPEN_SANS = unit(
  'on',
  'Open Sans font: on or off',
  "translators: If there are characters in your language that are not supported",
  "by Open Sans, translate this to 'off'. Do not translate into your own",
  'language.',
)
const DECLENSION = unit(
  'off',
  'Comment number declension: on or off',
  'translators: If comment number in your language requires declension,',
  "translate this to 'on'. Do not translate into your own language.",
)
const WORD_COUNT = unit(
  'words',
  'Word count type. Do not translate!',
  "translators: If your word count is based on single characters (e.g. East Asian characters), enter 'characters_excluding_spaces' or 'characters_including_spaces'. Otherwise, enter 'words'. Do not translate into your own language.",
)
const SUBSET = unit(
  'no-subset',
  'Open Sans font: add new subset (greek, cyrillic, vietnamese)',
  "translators: To add an additional Open Sans character subset specific to your language, translate this to 'greek', 'cyrillic' or 'vietnamese'. Do not translate into your own language.",
)
const DIRECTION = unit('ltr', 'text direction', "translators: 'rtl' or 'ltr'. This sets the text direction for WordPress.")
const LANG = unit(
  'html_lang_attribute',
  undefined,
  'translators: Translate this to the correct language tag for your locale, see https://www.w3.org/International/articles/language-tags/ for reference. Do not translate into your own language.',
)
const THOUSANDS = unit('number_format_thousands_sep', undefined, "translators: $thousands_sep argument for https://www.php.net/number_format, default is ','")
const FONT = unit(
  'Noto Serif:400,400i,700,700i',
  'Google Font Name and Variants',
  "translators: Use this to specify the proper Google Font name and variants to load that is supported by your language. Do not translate. Set to 'off' to disable loading.",
)

describe('controlSpec', () => {
  it.each([
    ['Open Sans on/off', OPEN_SANS, ['on', 'off']],
    ['comment number declension', DECLENSION, ['off', 'on']],
    ['word count type', WORD_COUNT, ['words', 'characters_excluding_spaces', 'characters_including_spaces']],
    ['font subset', SUBSET, ['no-subset', 'greek', 'cyrillic', 'vietnamese']],
    ['text direction', DIRECTION, ['ltr', 'rtl']],
  ])('reads %s as a switch with its allowed values', (_, u, allowed) => {
    expect(controlSpec(u)?.allowed).toEqual(allowed)
  })

  // A setting, but any value is possible: a language tag, a separator, a font.
  it.each([
    ['the html lang attribute', LANG],
    ['the thousands separator', THOUSANDS],
    ['the Google Font spec', FONT],
  ])('reads %s as a free-form setting', (_, u) => {
    const spec = controlSpec(u)
    expect(spec).toBeDefined()
    expect(spec?.allowed).toBeUndefined()
  })

  // Ordinary UI text, despite a context that says "on or off".
  it('leaves a real label alone even when its context mentions on or off', () => {
    expect(controlSpec(unit('Display as range', 'Turns reading time range display on or off'))).toBeUndefined()
  })

  it('leaves placeholder instructions to the placeholder rule', () => {
    expect(
      controlSpec(unit('Howdy ###USERNAME###', undefined, 'translators: Do not translate USERNAME, SITE_NAME: those are placeholders.')),
    ).toBeUndefined()
  })

  it('leaves an ordinary string alone', () => {
    expect(controlSpec(unit('Settings', undefined))).toBeUndefined()
  })
})

const ctxFor = (...entries: ReturnType<typeof unit>[]) =>
  buildRuleContext({ locale: 'tr', glossary: [], nplurals: 2, entries: entries.map((e) => ({ ...e, msgstr: [], fuzzy: false })) })

describe('the control rule', () => {
  it('condemns a switch translated as a word', () => {
    const f = runRules({ ...OPEN_SANS, msgstr: ['açık'], fuzzy: false }, ctxFor(OPEN_SANS))
    expect(f).toEqual([
      { rule: 'control', severity: 'error', message: expect.stringMatching(/setting.*"on" or "off"/) },
    ])
  })

  // The untranslated rule would flag "on" kept as "on", and invite the AI to
  // "fix" it into a word. A control string answers to its own rule alone.
  it('accepts an allowed value and silences every other rule', () => {
    expect(runRules({ ...OPEN_SANS, msgstr: ['on'], fuzzy: false }, ctxFor(OPEN_SANS))).toEqual([])
    expect(runRules({ ...DIRECTION, msgstr: ['ltr'], fuzzy: false }, ctxFor(DIRECTION))).toEqual([])
  })

  it('does not judge the value of a free-form setting', () => {
    expect(runRules({ ...LANG, msgstr: ['tr'], fuzzy: false }, ctxFor(LANG))).toEqual([])
    expect(runRules({ ...THOUSANDS, msgstr: ['.'], fuzzy: false }, ctxFor(THOUSANDS))).toEqual([])
  })
})

describe('the prompts', () => {
  it('flag a control string and say what it is, in review and in translate', () => {
    const review = buildAuditPrompt(
      [{ id: 1, key: 'k', msgid: 'on', msgctxt: 'Open Sans font: on or off', msgstr: ['açık'], comments: [], references: [], hints: [], control: true }],
      'tr',
      2,
    )
    expect(review).toContain('"control":true')
    expect(review).toMatch(/"control".*setting/)
    const translate = buildReviewPrompt([{ key: 'k', msgid: 'on', comments: [], drafts: ['on'], control: true }], 'tr', 2)
    expect(translate).toContain('"control":true')
    expect(translate).toMatch(/"control".*setting/)
  })
})
