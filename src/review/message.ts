/**
 * The one-line message a reviewer posts back to the requester.
 *
 * Built from the run's own numbers so the sentence cannot drift from what the
 * results screen showed.
 *
 * The link was left empty at first, on the reasoning that only the reviewer
 * knows which translations page they mean. They do, and so does the run:
 * GlotPress names its exports after the project path, so the file already
 * carries the project, the branch and the locale, and the reviewer's own
 * wp.org login is a standing setting rather than a per-run choice. What
 * survives of that reasoning is the refusal to guess, in translationsUrl
 * below: a file it cannot read gets no link rather than a plausible one, since
 * the message is bound for a public forum and a wrong link sends a contributor
 * to a 404 under the reviewer's name.
 */
import { basename } from 'node:path'
import { localeFileTag, splitLocale } from '../wporg/locales.js'

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
 * print more of something than there were entries altogether, 25 glossary
 * fixes out of 24 entries, so the rounding goes down instead. That is the one
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

export const WPORG_BASE = 'https://translate.wordpress.org/projects'

// What the reviewer would have picked by hand: their own translations in this
// project, in any state, which is the set the message is claiming credit for.
// Written with literal brackets and bare ampersands, exactly as wp.org's own
// URLs carry them, because the reviewer recognises that form and pastes it into
// editors that mangle percent-escapes and entities alike.
const FILTERS =
  'filters[translated]=yes&filters[status]=current_or_waiting_or_fuzzy_or_untranslated&filters[user_login]='

// Suffixes this tool appends itself: review writes the repaired catalogue, and
// split writes the numbered parts, in both the shapes it has used. None is part
// of a project's name, and a reviewer who reviewed one part still wants the
// whole project's page.
const OWN_SUFFIX = /(?:-repaired|-(?:part-)?\d+)+$/

/**
 * Core projects, which are neither plugins nor themes and share no shape with
 * them: no branch, and a path that cannot be read out of the export's name.
 * `patterns-core` maps to `patterns/core` and that is the whole rule for it,
 * which is why this is a table of pages someone has actually opened rather
 * than a parse. Splitting the name on its hyphen would produce the right
 * answer here and a wrong one for the next project whose own name holds one.
 *
 * Keyed by the export's name with the locale already taken off. Add an entry
 * when a real URL has been checked in a browser, not before: the cost of
 * being wrong is a contributor sent to a 404 by a message signed in the
 * reviewer's name.
 */
const CORE_PROJECTS: Record<string, string> = {
  'patterns-core': 'patterns/core',
}

/**
 * The translations page the message should link to, or undefined.
 *
 * Reads the project path back out of the name GlotPress gave its own export. A
 * plugin's name carries a branch and a theme's does not, and neither slug can
 * be told from the locale by shape alone, since both may hold any number of
 * hyphens: twenty-twenty-four-pt-br splits either way. The run's own locale is
 * what settles it, which is why this takes one and insists the file agrees
 * with it. Where they disagree the name has not been understood at all, and
 * the slug taken from it would be wrong too.
 *
 * Core projects take none of that and are looked up by name instead. Anything
 * in neither camp is undefined, which is the honest answer for a name this has
 * never been shown the page for. An empty username is undefined for the same
 * reason: an unfiltered page would show the whole project's translations and
 * claim them as the reviewer's own work.
 */
export function translationsUrl(file: string, locale: string, username: string): string | undefined {
  if (!username) return undefined
  const name = basename(file).replace(/\.po$/i, '').replace(OWN_SUFFIX, '')
  // A file name cannot hold the slash of nl/formal, so it is written nl-formal.
  const suffix = `-${localeFileTag(locale)}`
  if (!name.toLowerCase().endsWith(suffix.toLowerCase())) return undefined
  const body = name.slice(0, -suffix.length)
  const { slug, set } = splitLocale(locale)
  const at = `${slug}/${set}`

  const plugin = /^wp-plugins-(.+)-(dev-readme|stable-readme|dev|stable)$/.exec(body)
  if (plugin) return `${WPORG_BASE}/wp-plugins/${plugin[1]!}/${plugin[2]!}/${at}/?${FILTERS}${username}`

  const theme = /^wp-themes-(.+)$/.exec(body)
  if (theme) return `${WPORG_BASE}/wp-themes/${theme[1]!}/${at}/?${FILTERS}${username}`

  const core = CORE_PROJECTS[body]
  if (core) return `${WPORG_BASE}/${core}/${at}/?${FILTERS}${username}`

  return undefined
}

export interface ReportInput {
  repaired: number
  byGroup: Record<string, number>
  // Where the reviewed catalogue came from, and the locale it was reviewed in.
  // Both only feed the link, so both are optional: a caller that cannot say
  // gets the sentence with the empty href it always had.
  file?: string
  locale?: string
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
export function buildReport(input: ReportInput, username = ''): string | undefined {
  const { repaired, byGroup } = input
  if (repaired <= 0) return undefined

  const href =
    input.file === undefined || input.locale === undefined
      ? undefined
      : translationsUrl(input.file, input.locale, username)
  const opening = `I fixed ${repaired} ${repaired === 1 ? 'entry' : 'entries'}, which you can see <a href="${href ?? ''}">here</a>.`

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
