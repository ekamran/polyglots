import { STATS_TRANSLATIONS } from './translations-data.js'

// The page carries every language at once and CSS shows one, because the
// alternative is JavaScript and this file has to survive being mailed as an
// attachment and opened offline years later.
//
// English lives here, beside the code that renders it, and nowhere else. Every
// other language comes from a .po file in i18n/stats, translated against the
// template generated from this table (npm run stats-pot) and embedded at build
// time by scripts/stats-i18n.mjs. Turkish used to sit in this table as a second
// column; it moved out so the next language is a file a translator sends, not a
// change to the code.

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
}

export interface StatsLanguage {
  // A BCP 47 tag. It becomes the page's lang attribute, which is not
  // decoration: without lang="tr", text-transform: uppercase turns "istatistik"
  // into "ISTATISTIK" rather than "İSTATİSTİK".
  tag: string
  phrases: Partial<Record<string, string>>
}

export const ENGLISH: StatsLanguage = { tag: 'en', phrases: PHRASES }

/** The languages built into this copy, English excluded. */
export const BUILT_IN_LANGUAGES: readonly StatsLanguage[] = STATS_TRANSLATIONS

/** A phrase in a language, or the English when that language has not translated it. */
export function phrase(key: PhraseKey, lang: StatsLanguage): string {
  return lang.phrases[key] || PHRASES[key]
}

// Grouping and decimal marks differ (Turkish groups thousands with a dot), so
// the same figure is printed once per language rather than once in a neutral
// format that would be wrong in all but one.
export function count(n: number, lang: StatsLanguage): string {
  return n.toLocaleString(lang.tag)
}

export function duration(ms: number, lang: StatsLanguage): string {
  const unit = (key: PhraseKey, n: string) => phrase(key, lang).replace('{n}', n)
  if (ms < 60_000) return unit('durationSeconds', count(Math.round(ms / 1000), lang))
  if (ms < 3_600_000) return unit('durationMinutes', count(Math.round(ms / 60_000), lang))
  const hours = (ms / 3_600_000).toLocaleString(lang.tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return unit('durationHours', hours)
}
