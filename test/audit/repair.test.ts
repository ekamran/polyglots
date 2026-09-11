import { describe, expect, it } from 'vitest'
import { judgeFix, REPAIRABLE_RULES, repairMechanically } from '../../src/audit/repair.js'
import { buildRuleContext } from '../../src/audit/rules/index.js'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'

function entry(msgid: string, msgstr: string[]): AuditEntry {
  return { key: msgid, msgid, msgstr, comments: [], references: [], fuzzy: false }
}

describe('repairMechanically', () => {
  it('restores a trailing space the contributor dropped', () => {
    expect(repairMechanically(entry('Save changes ', ['Değişiklikleri kaydet']))).toEqual([
      'Değişiklikleri kaydet ',
    ])
  })

  it('restores leading whitespace', () => {
    expect(repairMechanically(entry('  Indented', ['Girintili']))).toEqual(['  Girintili'])
  })

  it('removes whitespace the contributor added that the source does not have', () => {
    expect(repairMechanically(entry('Save', ['Kaydet  ']))).toEqual(['Kaydet'])
  })

  it('keeps tabs and newlines exactly as the source has them', () => {
    expect(repairMechanically(entry('\tLine\n', ['Satır']))).toEqual(['\tSatır\n'])
  })

  it('leaves an entry whose whitespace already matches alone', () => {
    expect(repairMechanically(entry('Save changes', ['Değişiklikleri kaydet']))).toBeUndefined()
  })

  // Every plural form is a translation of the same source, so they all get the
  // same treatment. A form left empty stays empty: there is nothing to repair.
  it('repairs every plural form and leaves empty ones empty', () => {
    const plural = { ...entry('%s item ', ['%s öğe', '%s öğe', '']), msgidPlural: '%s items ' }
    expect(repairMechanically(plural)).toEqual(['%s öğe ', '%s öğe ', ''])
  })

  // A msgstr of nothing but spaces is not a translation to repair. Trimming it to
  // empty would be counted as a repair, which claims a correction that blanked
  // the entry instead.
  it('leaves a whitespace-only translation alone rather than blanking it', () => {
    expect(repairMechanically(entry('Save ', ['   ']))).toBeUndefined()
  })

  it('leaves an untranslated entry alone', () => {
    expect(repairMechanically(entry('Save ', ['']))).toBeUndefined()
  })

  // Only rules whose correct output is computable qualify. punctuation is a
  // suspect the model is supposed to judge, so it is deliberately not here.
  it('names only the rules it can actually invert', () => {
    expect([...REPAIRABLE_RULES]).toEqual(['whitespace'])
  })
})

const GLOSSARY: GlossaryEntry[] = [
  { locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu', partOfSpeech: 'noun' },
]

function ctxFor(entries: AuditEntry[]) {
  return buildRuleContext({ locale: 'tr', glossary: GLOSSARY, nplurals: 2, entries })
}

describe('judgeFix', () => {
  const broken = entry('%s comments', ['yorumlar'])
  const ctx = ctxFor([broken])

  it('accepts a fix that clears the finding', () => {
    expect(judgeFix({ entry: broken, fix: ['%s yorum'], nplurals: 2, ctx })).toEqual({ accepted: ['%s yorum'] })
  })

  // The case the whole guard exists for: a model asked to restore one
  // placeholder can drop another, and the comment would claim it was repaired.
  it('rejects a fix that trades one error for another', () => {
    const twoHoles = entry('%1$s of %2$s', ['%1$s'])
    const verdict = judgeFix({ entry: twoHoles, fix: ['%1$s tanesi'], nplurals: 2, ctx: ctxFor([twoHoles]) })
    expect(verdict).toEqual({ rejected: expect.stringMatching(/placeholder/i) })
  })

  it('rejects a fix identical to what was submitted, since that repairs nothing', () => {
    expect(judgeFix({ entry: broken, fix: ['yorumlar'], nplurals: 2, ctx })).toEqual({
      rejected: expect.stringMatching(/unchanged/i),
    })
  })

  it('rejects a fix with the wrong number of plural forms', () => {
    const plural = { ...entry('%s item', ['%s öğe', '%s öğe']), msgidPlural: '%s items' }
    const verdict = judgeFix({ entry: plural, fix: ['%s öğe'], nplurals: 2, ctx: ctxFor([plural]) })
    expect(verdict).toEqual({ rejected: expect.stringMatching(/plural/i) })
  })

  it('rejects an empty fix', () => {
    expect(judgeFix({ entry: broken, fix: [''], nplurals: 2, ctx })).toEqual({
      rejected: expect.stringMatching(/empty/i),
    })
  })

  // A soft finding is the model's to weigh, and it just did. Only mechanical
  // facts reject a fix, or nothing the model writes could ever be accepted.
  it('accepts a fix that trips only a suspect rule', () => {
    const wordy = entry('Open the sidebar', ['Yan menüyü aç'])
    const verdict = judgeFix({ entry: wordy, fix: ['Yan menüyü açın'], nplurals: 2, ctx: ctxFor([wordy]) })
    expect(verdict).toEqual({ accepted: ['Yan menüyü açın'] })
  })
})
