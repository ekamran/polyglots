import { describe, expect, it } from 'vitest'
import { REPAIRABLE_RULES, repairMechanically } from '../../src/audit/repair.js'
import type { AuditEntry } from '../../src/types.js'

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

  it('leaves an untranslated entry alone', () => {
    expect(repairMechanically(entry('Save ', ['']))).toBeUndefined()
  })

  // Only rules whose correct output is computable qualify. punctuation is a
  // suspect the model is supposed to judge, so it is deliberately not here.
  it('names only the rules it can actually invert', () => {
    expect([...REPAIRABLE_RULES]).toEqual(['whitespace'])
  })
})
