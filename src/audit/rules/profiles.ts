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
  'punctuation',
  'glossary',
  'inconsistent',
  // The memory is per locale and says nothing about a language's orthography,
  // so a conflict with it is worth reporting wherever polyglots is used.
  'tm-conflict',
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
    rules: new Set([...UNIVERSAL, 'title-case', 'apostrophe']),
    glossaryStemRatio: 0.7,
  },
}

export function profileFor(locale: Locale): RuleProfile {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? locale
  return BY_LANGUAGE[language] ?? DEFAULT_PROFILE
}
