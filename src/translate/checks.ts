import { repairMechanically } from '../audit/repair.js'
import { buildRuleContext, runRules, type RuleContext } from '../audit/rules/index.js'
import { applyFixPatterns } from '../rules/custom.js'
import { CUSTOM_RULE } from '../rules/names.js'
import type { AuditEntry, Finding, GlossaryEntry, Locale, ReviewResult, TranslationUnit } from '../types.js'

// The checks that mean something on a draft this tool wrote itself. Left out:
// `inconsistent`, which compares a contributor's file against itself, and
// `tm-conflict`, since an exact memory match never reaches the draft engine.
// The locale's own switches still apply: a rule its profile turns off stays off.
const DRAFT_RULES = new Set([
  'placeholder',
  'html',
  'plural-count',
  'whitespace',
  'escaping',
  'untranslated',
  'punctuation',
  'line-breaks',
  'ampersand',
  'number-format',
  'title-case',
  'glossary',
  'apostrophe',
  'control',
  CUSTOM_RULE,
])

export interface DraftChecker {
  /** Drafts with mechanical repairs and fix patterns applied, and what each still fails. */
  prepare(unit: TranslationUnit, drafts: string[]): { drafts: string[]; checks: string[] }
  /** The AI's answer with fix patterns applied, fuzzy if an error-level check still fails. */
  finalize(unit: TranslationUnit, result: ReviewResult): ReviewResult
}

export interface DraftCheckerOptions {
  locale: Locale
  nplurals: number
  glossary: GlossaryEntry[]
  properNouns: string[]
  units: TranslationUnit[]
}

const asEntry = (unit: TranslationUnit, msgstr: string[]): AuditEntry => ({ ...unit, msgstr, fuzzy: false })

/**
 * Review's rules, run on translate's own drafts.
 *
 * Three points in the pipeline. Before the AI pass, mechanical repairs and the
 * locale file's fix patterns are applied, so the AI judges "Ön izleme" rather
 * than spending its attention on a mistake that needed none. Then each draft's
 * remaining findings travel with it as `automatedChecks`, which the AI fixes or
 * clears exactly as it does for a contributor's submission in review. After the
 * AI pass, the fixes are applied once more, since the AI can write a mistake
 * back in, and an error-level check that still fails marks the entry fuzzy.
 * A hint that still fails does not: the AI already weighed it.
 */
export function createDraftChecker(opts: DraftCheckerOptions): DraftChecker {
  const base = buildRuleContext({
    locale: opts.locale,
    glossary: opts.glossary,
    nplurals: opts.nplurals,
    entries: opts.units.map((u) => asEntry(u, [])),
    properNouns: opts.properNouns,
  })
  const ctx: RuleContext = {
    ...base,
    profile: { ...base.profile, rules: new Set([...base.profile.rules].filter((r) => DRAFT_RULES.has(r))) },
  }

  const fix = (unit: TranslationUnit, forms: string[]): string[] => {
    const restored = repairMechanically(asEntry(unit, forms)) ?? forms
    return applyFixPatterns({ msgid: unit.msgid, msgstr: restored }, ctx.customPatterns ?? [], ctx.locale)?.forms ?? restored
  }
  const findings = (unit: TranslationUnit, forms: string[]): Finding[] => runRules(asEntry(unit, forms), ctx)

  return {
    prepare(unit, drafts) {
      const fixed = fix(unit, drafts)
      return { drafts: fixed, checks: findings(unit, fixed).map((f) => `${f.rule}: ${f.message}`) }
    },
    finalize(unit, result) {
      const text = fix(unit, result.text)
      const errors = findings(unit, text).filter((f) => f.severity === 'error')
      if (errors.length === 0) return { ...result, text }
      const still = `Still failing: ${errors.map((f) => `${f.rule}: ${f.message}`).join('; ')}`
      return { ...result, text, fuzzy: true, reason: result.reason ? `${result.reason} ${still}` : still }
    },
  }
}
