import type { AuditEntry } from '../types.js'

/**
 * What the memory can settle about an entry on its own, without a model.
 *
 * `approve`: the submission is a translation the locale already approved for
 * this exact source, word for word, capitals aside. `repair`: the contributor
 * left the English in place where the memory holds the approved Turkish, so
 * the approved string is the fix and there is nothing to weigh.
 */
export type MemoryDecision = { kind: 'approve' } | { kind: 'repair'; text: string[] }

/**
 * Settles an entry from the memory, or returns undefined to leave it to the
 * model as before.
 *
 * Measured on wp-themes-business-roy-tr.po against a 94,435-row memory: 71 of
 * 1,359 submissions were identical to an approved translation and 173 had been
 * left in English where the memory held the approved text. Every one of them
 * went to a batch anyway. The memory has been in the prompt since 0.11.0, so
 * the model was being handed the answer and asked the question.
 *
 * A difference only of case is approved as written. Labels keep their capitals
 * by the locale team's own rule and the memory cannot tell a label from prose,
 * so the locale manager's ruling was that either casing is acceptable. The
 * contributor's is kept rather than rewritten to the memory's, since nothing
 * is gained by changing one acceptable text into another. Compared the Turkish
 * way, where I and İ lower to ı and i: a comparison that ignored that would
 * match words that differ and miss words that do not.
 *
 * Different wording is a judgement even when the memory looks better, which on
 * the sampled file it nearly always did, because the same source can mean
 * something else in another project and that is exactly what a model is asked
 * to notice.
 *
 * `exact` says the match was found under the entry's own context. The lookup
 * falls back to a row with no context when the scoped one is missing, which is
 * a fair hint for a prompt and no basis for deciding without one: a msgctxt
 * exists exactly where a source is ambiguous.
 *
 * A plural entry is never settled, since the memory holds one string per source
 * and nothing says which form it would be.
 */
export function decideFromMemory(entry: AuditEntry, memory: string | undefined, exact: boolean): MemoryDecision | undefined {
  if (memory === undefined || !exact) return undefined
  if (entry.msgidPlural !== undefined || entry.msgstr.length !== 1) return undefined
  const submitted = entry.msgstr[0]!
  if (submitted === memory) return { kind: 'approve' }
  if (submitted.toLocaleLowerCase('tr') === memory.toLocaleLowerCase('tr')) return { kind: 'approve' }
  if (submitted === entry.msgid) return { kind: 'repair', text: [memory] }
  return undefined
}
