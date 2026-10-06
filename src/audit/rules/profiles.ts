import { loadLocaleRules } from '../../rules/load.js'
import type { LocaleRules } from '../../rules/schema.js'
import { languageOf } from '../../wporg/locales.js'
import { CUSTOM_RULE } from '../../rules/names.js'
import type { Locale } from '../../types.js'

export interface RuleProfile {
  // Which rules run for this language. A rule left out never fires, so its
  // findings cannot reach the model or the report.
  rules: ReadonlySet<string>
  // How much of a glossary term must match before the rule accepts an inflected
  // form. Tuned for suffixing languages; a profile can tighten it.
  glossaryStemRatio: number
}

// These depend on nothing about a particular language: a dropped placeholder, a
// missing tag or a lost trailing space is wrong everywhere. `glossary` is here
// too because it runs off each locale's own approved terms.
const UNIVERSAL = [
  'placeholder',
  'html',
  'plural-count',
  'whitespace',
  'untranslated',
  // How a .po line spells its string, which no language's orthography touches.
  'escaping',
  // An email body has the same shape in every language.
  'line-breaks',
  'punctuation',
  'glossary',
  'inconsistent',
  // The memory is per locale and says nothing about a language's orthography,
  // so a conflict with it is worth reporting wherever polyglots is used.
  'tm-conflict',
  // A setting the code reads ("on" for a font switch) is one in every locale.
  'control',
] as const

export const DEFAULT_PROFILE: RuleProfile = {
  rules: new Set(UNIVERSAL),
  glossaryStemRatio: 0.7,
}

// A language only earns the orthography-specific rules once someone who speaks it
// says they apply. German is the clearest reason for that caution: it capitalizes
// every noun by rule, so `title-case` would flag correct translations wholesale.
const BY_LANGUAGE: Record<string, RuleProfile> = {
  tr: {
    // `ampersand` and `number-format` are conventions of this locale rather
    // than of gettext, so they wait for someone who speaks the language to say
    // they apply, exactly as the orthography rules do.
    rules: new Set([...UNIVERSAL, 'title-case', 'apostrophe', 'ampersand', 'number-format']),
    glossaryStemRatio: 0.7,
  },
}

// What the code ships for a language, before any rules file. Exported for the
// defaults `rules edit` writes out, which must describe exactly this.
export function builtInProfileFor(locale: Locale): RuleProfile {
  return BY_LANGUAGE[languageOf(locale)] ?? DEFAULT_PROFILE
}

export const UNIVERSAL_RULES: readonly string[] = UNIVERSAL

/**
 * The rules that run for a locale: the built-in profile, overridden by the
 * locale's rules file where it says something.
 *
 * A file that lists rules starts from the universal set rather than adding to
 * the built-in extras, so leaving `title-case` out of a Turkish file turns it
 * off. A file that says nothing about rules keeps the built-in profile, so
 * writing only a few mistakes changes nothing else.
 *
 * `custom` is never listed by name. It runs whenever the file has mistakes or
 * patterns, since writing one is the request to have it checked.
 */
export function profileFor(locale: Locale): RuleProfile {
  return mergeProfile(builtInProfileFor(locale), loadLocaleRules(locale))
}

// The rules file over the built-in profile. Separate so the menu editor can
// preview unsaved rules through exactly the logic a review will apply.
export function mergeProfile(base: RuleProfile, file: LocaleRules | undefined): RuleProfile {
  if (!file) return base
  const rules = file.rules
    ? new Set([...UNIVERSAL, ...file.rules.enable].filter((name) => !file.rules!.disable.includes(name)))
    : new Set(base.rules)
  if (file.patterns.length > 0) rules.add(CUSTOM_RULE)
  return { rules, glossaryStemRatio: file.glossaryStemRatio ?? base.glossaryStemRatio }
}
