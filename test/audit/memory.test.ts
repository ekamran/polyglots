import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../../src/types.js'
import { decideFromMemory } from '../../src/audit/memory.js'

function entry(msgid: string, msgstr: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  return { key: msgid, msgid, msgstr: [msgstr], comments: [], references: [], fuzzy: false, ...extra }
}

/**
 * Measured on wp-themes-business-roy-tr.po against a 94,435-row memory: 71 of
 * 1,359 submissions were identical to an approved translation of the same
 * source, and 173 had been left in English where the memory held the
 * approved Turkish. Neither needs a model to decide. The model was being
 * asked anyway, because every entry went to it whatever the memory said.
 */
describe('decideFromMemory', () => {
  it('approves a submission identical to the approved translation', () => {
    expect(decideFromMemory(entry('Font Size', 'Yazı Tipi Boyutu'), 'Yazı Tipi Boyutu', true)).toEqual({ kind: 'approve' })
  })

  it('repairs a submission left in English with the approved translation', () => {
    expect(decideFromMemory(entry('Large', 'Large'), 'Geniş', true)).toEqual({ kind: 'repair', text: ['Geniş'] })
  })

  /**
   * The locale manager's call: capitalisation that differs from the memory is
   * acceptable either way, since labels keep their capitals by the team's own
   * rule and the memory cannot tell a label from prose. The wording is the
   * approved wording, so it is approved as written, capitals and all, rather
   * than rewritten to the memory's casing or sent to be argued over.
   */
  it('approves a submission that differs from the memory only in case', () => {
    expect(decideFromMemory(entry('Hide Details', 'Ayrıntıları Gizle'), 'Ayrıntıları gizle', true)).toEqual({ kind: 'approve' })
  })

  // Turkish has two i's, and a case comparison that ignores that would call
  // "Işık" and "Isik" the same word, or fail to match "İleri" to "ileri".
  it('compares case the Turkish way', () => {
    expect(decideFromMemory(entry('Next', 'İleri'), 'ileri', true)).toEqual({ kind: 'approve' })
    expect(decideFromMemory(entry('Light', 'IŞIK'), 'ışık', true)).toEqual({ kind: 'approve' })
    expect(decideFromMemory(entry('Light', 'ISIK'), 'ışık', true)).toBeUndefined()
  })

  // Different wording is a judgement, and judgement is what the model is for.
  it('leaves different wording to the model', () => {
    expect(decideFromMemory(entry('Posts navigation', 'Gönderi navigasyonu'), 'Yazı gezinmesi', true)).toBeUndefined()
  })

  /**
   * A msgctxt exists exactly where a string is ambiguous, and the lookup falls
   * back to a row without context when the scoped one is missing. That is a
   * fair hint for a prompt and no basis for deciding without one.
   */
  it('decides nothing from a match found only by dropping the context', () => {
    expect(decideFromMemory(entry('Large', 'Large', { msgctxt: 'font size' }), 'Geniş', false)).toBeUndefined()
    expect(decideFromMemory(entry('Font Size', 'Yazı Tipi Boyutu'), 'Yazı Tipi Boyutu', false)).toBeUndefined()
  })

  it('decides nothing without a memory', () => {
    expect(decideFromMemory(entry('Large', 'Large'), undefined, true)).toBeUndefined()
  })

  // The memory holds one string per source. A plural entry has several forms
  // and nothing here says which one it would be.
  it('leaves plural entries alone', () => {
    const plural = entry('%d item', '%d öğe', { msgidPlural: '%d items', msgstr: ['%d öğe', '%d öğe'] })
    expect(decideFromMemory(plural, '%d öğe', true)).toBeUndefined()
  })
})
