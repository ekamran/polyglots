import { count, duration, percent, phrase, phraseWith, type PhraseKey, type StatsLanguage } from '../i18n.js'

// Text a contributor chose (project names, file names) goes through this on
// its way into markup, and real names carry ampersands ("Malware Removal &
// Auto Cleanup"). Unescaped, a name could also close a tag and rewrite the
// rest of the page, which on a localhost server is a script running with the
// page's token.
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The phrase helpers a view needs, bound to one language. */
export interface Say {
  lang: StatsLanguage
  t(key: PhraseKey): string
  tn(key: PhraseKey, n: string): string
  n(value: number): string
  pct(fraction: number): string
  dur(ms: number): string
}

export function sayer(lang: StatsLanguage): Say {
  return {
    lang,
    t: (key) => esc(phrase(key, lang)),
    tn: (key, n) => esc(phraseWith(key, lang, n)),
    n: (value) => esc(count(value, lang)),
    pct: (fraction) => esc(percent(fraction, lang)),
    dur: (ms) => esc(duration(ms, lang)),
  }
}

/** YYYY-MM-DD in UTC, for a timestamp. */
export function isoDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}
