import { stringify } from 'yaml'
import { repairMechanically } from '../audit/repair.js'
import { buildRuleContext, runRules, type RuleContext } from '../audit/rules/index.js'
import { builtInProfileFor, mergeProfile } from '../audit/rules/profiles.js'
import { mergeProperNouns } from '../audit/rules/proper-nouns.js'
import { lower } from '../audit/rules/text.js'
import type { AuditEntry, Finding, GlossaryEntry } from '../types.js'
import { applyFixPatterns } from './custom.js'
import type { RulesDraft, RulesValue } from './edit.js'
import { parseLocaleRules } from './load.js'

export interface TrySample {
  source: string
  translation: string
}

export interface TryResult {
  findings: Finding[]
  // The translation after mechanical repairs and fix patterns, when they changed it.
  fixed?: string
}

/**
 * What the rules being edited would say about one sample, before anything is
 * saved.
 *
 * The unsaved value goes through the same parser a saved file does, so an
 * invalid rule is reported here exactly as `rules check` would report it, and
 * through the same profile merge a review applies, so the preview cannot
 * disagree with the run it previews.
 */
export function tryRules(draft: RulesDraft, value: RulesValue, sample: TrySample, glossary: GlossaryEntry[] = []): TryResult {
  const rules = parseLocaleRules(stringify(value), draft.path)
  const locale = draft.locale
  const entry: AuditEntry = { key: 'try', msgid: sample.source, msgstr: [sample.translation], comments: [], references: [], fuzzy: false }
  const base = buildRuleContext({ locale, glossary, nplurals: 2, entries: [entry] })
  const nouns = mergeProperNouns(draft.builtIn.properNouns, rules.properNouns)
  const ctx: RuleContext = {
    ...base,
    profile: mergeProfile(builtInProfileFor(locale), rules),
    properNouns: { always: nouns.always.map((n) => lower(n, locale)), dateOnly: nouns.dateOnly.map((n) => lower(n, locale)) },
    ...(rules.patterns.length > 0 ? { customPatterns: rules.patterns } : {}),
  }
  const restored = repairMechanically(entry) ?? entry.msgstr
  const fixed = applyFixPatterns({ msgid: entry.msgid, msgstr: restored }, rules.patterns, locale)?.forms ?? restored
  const findings = runRules({ ...entry, msgstr: fixed }, ctx)
  return fixed[0] !== sample.translation ? { findings, fixed: fixed[0]! } : { findings }
}
