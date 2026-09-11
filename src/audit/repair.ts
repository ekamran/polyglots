import type { AuditEntry } from '../types.js'

// Rules whose correct output is computable from the source, so no judgment and
// no model call is needed. A rule qualifies only if it is `error` severity and
// exactly invertible: `punctuation` looks similar but is a `suspect`, meaning
// the locale team wants the model to decide, and forcing it here would overrule
// that. This list is part of the resume fingerprint, so adding to it correctly
// refuses to resume a review that ran under the old set.
export const REPAIRABLE_RULES = ['whitespace'] as const

const LEAD = /^\s*/
const TRAIL = /\s*$/

function edges(value: string): { lead: string; trail: string; body: string } {
  const lead = LEAD.exec(value)![0]
  const trail = TRAIL.exec(value)![0]
  return { lead, trail, body: value.slice(lead.length, value.length - trail.length) }
}

// Gives every translated plural form the source's leading and trailing
// whitespace. Returns undefined when there was nothing to fix, so the caller can
// tell a repair from a no-op.
export function repairMechanically(entry: AuditEntry): string[] | undefined {
  const source = edges(entry.msgid)
  let changed = false

  const repaired = entry.msgstr.map((form) => {
    if (form === '') return form
    const target = edges(form)
    if (target.lead === source.lead && target.trail === source.trail) return form
    changed = true
    return `${source.lead}${target.body}${source.trail}`
  })

  return changed ? repaired : undefined
}
