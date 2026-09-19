/**
 * The one-line message a reviewer posts back to the requester.
 *
 * Built from the run's own numbers so the sentence cannot drift from what the
 * results screen showed. The link is deliberately left empty: only the reviewer
 * knows which translations page they want to point at, and guessing a URL into
 * a message destined for a public forum is not a guess worth making.
 */

export interface ReportGroup {
  key: string
  // Agreement follows the real count, not the rounded one. A group of one prints
  // as `1`, so a plural noun beside it would be visibly wrong.
  singular: string
  plural: string
  rules: ReadonlySet<string>
}

// Everything a named group does not claim. A catch-all rather than a list, so a
// rule added later still reaches the sentence instead of silently vanishing
// from a breakdown that claims to account for every entry.
export const OTHER_GROUP = 'other'

// Order is print order. Glossary leads because it is the finding a requester can
// most readily act on: the terms are published, so the fix is lookup, not taste.
export const REPORT_GROUPS: readonly ReportGroup[] = [
  {
    key: 'glossary',
    singular: 'glossary inconsistency',
    plural: 'glossary inconsistencies',
    rules: new Set(['glossary', 'ai:glossary']),
  },
  {
    key: 'meaning',
    singular: 'meaning and fluency problem',
    plural: 'meaning and fluency problems',
    // Register sits here rather than under other: it is a judgement about
    // wording, which is what a requester hears in "meaning and fluency".
    rules: new Set(['ai:meaning', 'ai:fluency', 'ai:register']),
  },
  {
    key: 'title-case',
    singular: 'title-case issue',
    plural: 'title-case issues',
    rules: new Set(['title-case', 'ai:title-case']),
  },
]

export function groupFor(rule: string): string {
  for (const group of REPORT_GROUPS) {
    if (group.rules.has(rule)) return group.key
  }
  return OTHER_GROUP
}

/**
 * A count as the message should say it.
 *
 * Rounded to the nearest five once there is enough to round, because the exact
 * figure invites a requester to audit arithmetic against a tally they cannot
 * see, and the point of the sentence is the shape of the problem. Below five it
 * prints exactly: rounding a two to the nearest five would report zero of
 * something that demonstrably happened.
 *
 * `cap` is the total the sentence already claimed. Rounding up past it would
 * print more of something than there were entries altogether — 25 glossary
 * fixes out of 24 entries — so the rounding goes down instead. That is the one
 * direction an approximation cannot be allowed to err in a message someone
 * else will read.
 */
export function roundCount(n: number, cap = Number.POSITIVE_INFINITY): string {
  if (n < 5) return String(n)
  const nearest = Math.round(n / 5) * 5
  return `~${nearest > cap ? Math.floor(n / 5) * 5 : nearest}`
}

// "A", "A and B", "A, B and C". No serial comma, matching the prose everywhere
// else in this project.
function series(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`
}

export interface ReportInput {
  repaired: number
  byGroup: Record<string, number>
}

/**
 * The message, or undefined when there is nothing to report.
 *
 * `They included …` rather than `There were …` on purpose: the verb in the
 * second form has to agree with whatever the run happened to produce, and the
 * list changes shape from one run to the next. This form agrees with `they`,
 * which is always the entries, so the sentence stays grammatical whether one
 * group fired or all three.
 */
export function buildReport(input: ReportInput): string | undefined {
  const { repaired, byGroup } = input
  if (repaired <= 0) return undefined

  const opening = `I fixed ${repaired} ${repaired === 1 ? 'entry' : 'entries'}, which you can see <a href="">here</a>.`

  const named: string[] = []
  for (const group of REPORT_GROUPS) {
    const n = byGroup[group.key] ?? 0
    if (n <= 0) continue
    named.push(`${roundCount(n, repaired)} ${n === 1 ? group.singular : group.plural}`)
  }
  const other = byGroup[OTHER_GROUP] ?? 0

  if (named.length === 0) {
    return other > 0 ? `${opening} They were a mix of smaller issues.` : opening
  }
  const tail = other > 0 ? ', plus a few smaller ones' : ''
  return `${opening} They included ${series(named)}${tail}.`
}
