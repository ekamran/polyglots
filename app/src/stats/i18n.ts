import { FINDING_KEYS, findingLabel } from '../rules/names.js'
import { STATS_TRANSLATIONS } from './translations-data.js'

// Every language the page knows travels inside it, in the script bundle, and
// the reader picks one. The server picks the first one from Accept-Language;
// the standalone copy starts in English.
//
// English lives here, beside the code that renders it, and nowhere else. Every
// other language comes from a .po file in i18n/stats, translated against the
// template generated from this table (npm run stats-pot) and embedded at build
// time by scripts/stats-i18n.mjs. Turkish used to sit in this table as a second
// column; it moved out so the next language is a file a translator sends, not a
// change to the code.
//
// This module is bundled for the browser, so it imports nothing from node:.

// Keys are the msgctxt of each template entry, so renaming one orphans every
// translation of it. Change the English freely: a translation whose msgid no
// longer matches is left out and English shows until it is updated.
export const PHRASES = {
  title: 'Review statistics',
  generated: 'generated',
  rangeTo: 'to',
  noneYet: 'No finished reviews recorded yet.',

  submissions: 'submissions reviewed',
  entries: 'entries',
  flagged: 'flagged',
  repaired: 'repaired automatically',
  turnaround: 'median turnaround',

  weeklyHeading: 'Entries reviewed, by week',
  peak: 'peak',
  donutHeading: 'What gets flagged',
  projectHeading: 'By project',

  colProject: 'Project',
  colSubmissions: 'Submissions',
  colEntries: 'Entries',
  colFlagged: 'Flagged',
  colRate: 'Rate',

  emptyBody: 'No finished reviews have been recorded yet. Run a review over a submission and its totals will appear here.',
  caveat:
    '“Flagged” counts entries polyglots raised for a human to look at: a mix of mechanical faults and judgement calls. It measures what this tool flags, not the quality of anyone’s work, and a flag is not a judgement about the contributor who submitted it.',
  incompleteOne: 'review did not finish and contributed nothing to these totals.',
  incompleteMany: 'reviews did not finish and contributed nothing to these totals.',

  translateHeading: 'Translation',
  translateWeekly: 'Entries drafted, by week',
  runs: 'runs',
  drafted: 'entries drafted',
  leftFuzzy: 'left fuzzy',
  skippedEntries: 'skipped by the engine',
  engineHeading: 'By engine',
  colEngine: 'Engine',
  colRuns: 'Runs',
  colMedian: 'Median',
  translateCaveat:
    '“Left fuzzy” counts drafts marked for a human to check before they ship. It is what the draft engine and its review were unsure about, not a count of mistakes.',

  durationSeconds: '{n}s',
  durationMinutes: '{n}m',
  durationHours: '{n}h',

  theme: 'Theme',
  themeAuto: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',

  navOverview: 'Overview',
  navReviews: 'Reviews',
  navTranslation: 'Translation',
  navProjects: 'Projects',
  navMethod: 'Method',

  rangeLabel: 'Time range',
  range30d: '30 days',
  range90d: '90 days',
  range1y: '1 year',
  rangeAll: 'All time',
  language: 'Language',

  inLast30: '{n} in the last 30 days',
  runningOne: '{n} review in progress, not counted until it finishes.',
  runningMany: '{n} reviews in progress, not counted until they finish.',
  busy: 'The job store is busy. Showing the last numbers and trying again.',

  activityHeading: 'Review activity, last 12 months',
  activityLess: 'Less',
  activityMore: 'More',

  flagsRule: 'Rule checks',
  flagsAi: 'AI review',
  flagsProcess: 'Not reviewed',
  flagsOther: 'Other',
  flagsShareNote:
    'Shares of all flags. One entry can carry several flags, so these add up to more than the flagged count.',
  flagShare: '{n} of all flags',

  turnaroundHeading: 'How long reviews take',
  bucket0: 'under 1 min',
  bucket1: '1–5 min',
  bucket2: '5–15 min',
  bucket3: '15–60 min',
  bucket4: '1–4 h',
  bucket5: 'over 4 h',

  showAll: 'Show all {n} projects',
  filterProjects: 'Filter projects',
  noTranslate: 'No translate runs in this range.',
  shareImage: 'Download share image',
  shareTagline: 'WordPress translation review with polyglots',
  shareTop: 'Top projects',

  methodHeading: 'How these numbers are made',
  methodEntries:
    'An entry is one translatable string. A submission is one review run over one .po file. Only reviews that finished are counted: a review stopped part way has no honest totals yet.',
  methodSplit:
    'Rule checks are mechanical: a placeholder is either missing or it is not. AI findings are a model’s judgement about meaning, tone and fluency, and deserve a second look before anyone acts on them.',
  methodTurnaround:
    'Turnaround runs from the start of a review to its end, including any time it was stopped and resumed. The median is shown because one overnight run would swamp an average.',
  methodDays: 'Days on the activity map are in local time. Weeks start on Monday and are counted in UTC.',
  methodNoRanking: 'This page never ranks contributors, and it never will.',
} as const satisfies Record<string, string>

export type PhraseKey = keyof typeof PHRASES

// What a translator cannot see from the string alone. They go into the template
// as extracted comments, which every .po editor shows beside the entry.
export const NOTES: Partial<Record<PhraseKey, string>> = {
  rangeTo: 'Between two dates, as in "2026-09-01 to 2026-09-30". A dash is fine.',
  entries: 'Follows a number: "4,102 entries". Also the word after "peak 310".',
  incompleteOne: 'Follows the number 1: "1 review did not finish…".',
  incompleteMany: 'Follows a number above 1: "3 reviews did not finish…".',
  caveat:
    'Read by the contributors whose work is being counted. Keep it plain and keep its point: a flag is about the tool, not the person.',
  translateCaveat: 'A fuzzy draft is the engine asking for a human, not a mistake. Keep that distinction.',
  durationSeconds: '{n} is a whole number of seconds. Keep {n} as it is.',
  durationMinutes: '{n} is a whole number of minutes. Keep {n} as it is.',
  durationHours: '{n} is hours with one decimal, already written the way your language writes decimals. Keep {n} as it is.',
  range30d: 'A button choosing the time range the page covers.',
  rangeAll: 'A button: count everything ever recorded.',
  inLast30: 'A context line under a big figure. {n} is a formatted number. Keep {n} as it is.',
  runningOne: '{n} is the number 1. Keep {n} as it is.',
  runningMany: '{n} is a number above 1. Keep {n} as it is.',
  flagShare: 'In a tooltip. {n} is a percentage such as "12%". Keep {n} as it is.',
  bucket0: 'A bar label in a chart of how long reviews take.',
  showAll: '{n} is the number of projects. Keep {n} as it is.',
  shareTagline: 'The footer of an image people post on social media and forums.',
  methodNoRanking: 'A promise to the contributors who read this page. Keep it as firm as the English.',
}

// Rule names and descriptions come from the rule metadata, so a new rule is
// named once, in English, beside the rule list, and arrives here as two more
// template entries. They are keyed by the finding key, so a translation
// survives a rewording of some other rule.
const RULE_PHRASES: Record<string, string> = Object.fromEntries(
  FINDING_KEYS.flatMap((key) => {
    const label = findingLabel(key)!
    return [
      [`rule:${key}`, label.name],
      [`rule:${key}:desc`, label.description],
    ]
  }),
)

const RULE_NOTES: Record<string, string> = Object.fromEntries(
  FINDING_KEYS.flatMap((key) => [
    [`rule:${key}`, `The name of a check ("${key}") in the legend of "What gets flagged". Sentence case.`],
    [`rule:${key}:desc`, `One line explaining the check "${key}", shown in a tooltip.`],
  ]),
)

/** Every string in the template: the page's own phrases, then the rule names. */
export const ALL_PHRASES: Record<string, string> = { ...PHRASES, ...RULE_PHRASES }
export const ALL_NOTES: Partial<Record<string, string>> = { ...NOTES, ...RULE_NOTES }

export interface StatsLanguage {
  // A BCP 47 tag. It becomes the page's lang attribute, which is not
  // decoration: without lang="tr", text-transform: uppercase turns "istatistik"
  // into "ISTATISTIK" rather than "İSTATİSTİK".
  tag: string
  phrases: Partial<Record<string, string>>
}

export const ENGLISH: StatsLanguage = { tag: 'en', phrases: ALL_PHRASES }

/** The languages built into this copy, English excluded. */
export const BUILT_IN_LANGUAGES: readonly StatsLanguage[] = STATS_TRANSLATIONS

/** A phrase in a language, or the English when that language has not translated it. */
export function phrase(key: PhraseKey, lang: StatsLanguage): string {
  return lang.phrases[key] || PHRASES[key]
}

/** A phrase with {n} filled in. */
export function phraseWith(key: PhraseKey, lang: StatsLanguage, n: string): string {
  return phrase(key, lang).replace('{n}', n)
}

/**
 * A finding key's name and description in a language. A key with no label (a
 * rule since retired, still in old rows) shows as itself, which is ugly but
 * honest; dropping it would make the legend disagree with the total.
 */
export function ruleText(key: string, lang: StatsLanguage): { name: string; description: string } {
  const english = findingLabel(key)
  if (english === undefined) return { name: key, description: '' }
  return {
    name: lang.phrases[`rule:${key}`] || english.name,
    description: lang.phrases[`rule:${key}:desc`] || english.description,
  }
}

// Grouping and decimal marks differ (Turkish groups thousands with a dot), so
// figures are formatted per language rather than once in a neutral format that
// would be wrong in all but one.
export function count(n: number, lang: StatsLanguage): string {
  return n.toLocaleString(lang.tag)
}

export function percent(fraction: number, lang: StatsLanguage): string {
  return fraction.toLocaleString(lang.tag, { style: 'percent', maximumFractionDigits: 0 })
}

export function duration(ms: number, lang: StatsLanguage): string {
  const unit = (key: PhraseKey, n: string) => phrase(key, lang).replace('{n}', n)
  if (ms < 60_000) return unit('durationSeconds', count(Math.round(ms / 1000), lang))
  if (ms < 3_600_000) return unit('durationMinutes', count(Math.round(ms / 60_000), lang))
  const hours = (ms / 3_600_000).toLocaleString(lang.tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return unit('durationHours', hours)
}

/**
 * The best language for an Accept-Language header, from the ones this copy
 * carries. Weighted by q, matched by primary subtag so tr-TR finds tr, and
 * English when nothing matches.
 */
export function negotiate(header: string | undefined, languages: readonly StatsLanguage[]): StatsLanguage {
  const all = [ENGLISH, ...languages]
  const wanted = (header ?? '')
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined)
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q), i }
    })
    .filter((w) => w.tag !== '' && w.tag !== '*' && w.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
  for (const w of wanted) {
    const exact = all.find((l) => l.tag.toLowerCase() === w.tag)
    if (exact) return exact
    const primary = w.tag.split('-')[0]
    const near = all.find((l) => l.tag.toLowerCase().split('-')[0] === primary)
    if (near) return near
  }
  return ENGLISH
}

/** A language by tag, for a ?lang= override; undefined when this copy lacks it. */
export function languageByTag(tag: string | null | undefined, languages: readonly StatsLanguage[]): StatsLanguage | undefined {
  if (!tag) return undefined
  return [ENGLISH, ...languages].find((l) => l.tag.toLowerCase() === tag.toLowerCase())
}
