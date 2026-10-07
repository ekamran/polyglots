import { builtInProfileFor, UNIVERSAL_RULES } from '../audit/rules/profiles.js'
import { wpCodeOf } from '../wporg/locales.js'
import { builtInProperNounsFor } from '../audit/rules/proper-nouns.js'
import { packFor } from './packs/index.js'
import { packLine } from './support.js'
import type { Locale } from '../types.js'
import { GUIDANCE_LIMIT } from './schema.js'

/** The first line of a rules file, which rules copy rewrites for the target. */
export const rulesHeader = (locale: Locale) => `# polyglots rules for ${wpCodeOf(locale) ?? locale} (${locale})`

const list = (items: readonly string[]) => `[${items.map((i) => JSON.stringify(i)).join(', ')}]`

// For a locale with no pack: examples that name no language, so a German team
// is not shown a Turkish spelling rule as the model of what to write.
const NEUTRAL_EXAMPLES = {
  mistakes: ['  - wrong: a wording your team rejects', '    right: the wording it uses instead', '    note: Why, for the reviewer'],
  patterns: ["  - find: ' {2,}'", "    replace: ' '", '    level: fix', '    note: One space between words'],
}

/**
 * The file `rules edit` writes when a locale has none: today's built-in
 * behaviour, spelled out, and an example of every section.
 *
 * Written with the built-in values commented out by default. A file that sets
 * nothing fingerprints as empty, so opening the editor and closing it again
 * changes no cache key and re-reviews nothing. `commented: false` writes the
 * same values live, which is how a test proves they match the code.
 */
export function renderDefaultRules(locale: Locale, opts: { commented?: boolean } = {}): string {
  const live = opts.commented === false
  const c = (line: string) => (live ? line : `# ${line}`)
  const profile = builtInProfileFor(locale)
  const nouns = builtInProperNounsFor(locale)
  const extras = [...profile.rules].filter((r) => !UNIVERSAL_RULES.includes(r))
  const pack = packFor(locale)
  const examples = pack?.examples ?? NEUTRAL_EXAMPLES

  return [
    rulesHeader(locale),
    // Said only when there is something to qualify. A maintained pack needs no
    // caveat, and leaving the line out keeps the Turkish template exactly as
    // every existing tr_TR.yaml was written from.
    ...(pack?.status === 'maintained' ? [] : [`# ${packLine(locale)}`]),
    '#',
    '# Every section is optional. A section left out keeps the built-in behaviour.',
    '# The built-in values are shown commented out; uncomment a section to change it.',
    '# Any change re-reviews files of this locale from scratch on their next run.',
    '# Check the file with: polyglots rules check ' + locale,
    '',
    `# Rules that always run unless disabled: ${UNIVERSAL_RULES.join(', ')}`,
    c('rules:'),
    c(`  enable: ${list(extras)}`),
    c('  disable: []'),
    '',
    '# How much of a glossary term must match an inflected form, between 0 and 1.',
    c(`glossaryStemRatio: ${profile.glossaryStemRatio}`),
    '',
    '# Names capitalized everywhere (always), and only inside a specific date (dateOnly).',
    c('properNouns:'),
    c(`  always: ${list(nouns.always)}`),
    c(`  dateOnly: ${list(nouns.dateOnly)}`),
    '',
    '# Common mistakes: found anywhere in a translation, case-insensitive.',
    '# The AI review weighs each match with your note.',
    'mistakes: []',
    ...examples.mistakes.map((line) => `#${line}`),
    '',
    '# Patterns: "text" (a literal) or "find" (a regular expression).',
    '# level: hint (the AI judges), error (always wrong, the AI must fix) or fix (replaced automatically).',
    '# "when: { source: ... }" applies a pattern only when the English source contains that text.',
    'patterns: []',
    ...examples.patterns.map((line) => `#${line}`),
    '',
    `# Guidance added to the AI review prompts, at most ${GUIDANCE_LIMIT} characters.`,
    '# guidance: |',
    '#   Button labels are verbs in the imperative.',
    '',
  ].join('\n')
}
