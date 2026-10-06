import { loadLocaleRules } from '../../rules/load.js'
import { languageOf } from '../../wporg/locales.js'
import type { Locale } from '../../types.js'

// Categories TDK capitalizes that a brand allowlist does not cover: day and
// month names, and the names of languages and peoples. Turkish keeps day and
// month names lowercase in generic use (okullar eylülde açılır) and capitalizes
// them only in a specific date, a distinction no pattern can make, so listing
// them trades the ability to flag a wrongly capitalized generic one for not
// flagging every legitimate date.
const TURKISH_DATE_ONLY: string[] = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

const TURKISH_ALWAYS: string[] = [
  'Türk',
  'Türkçe',
  'Türkiye',
  'İngiliz',
  'İngilizce',
  'Almanca',
  'Alman',
  'Fransızca',
  'Fransız',
  'İspanyolca',
  'İspanyol',
  'İtalyanca',
  'İtalyan',
  'Rusça',
  'Rus',
  'Arapça',
  'Arap',
  'Japonca',
  'Japon',
  'Çince',
  'Çin',
  'Korece',
  'Portekizce',
  'Hollandaca',
  'Lehçe',
  'İbranice',
  'Farsça',
  'Yunanca',
  'Yunan',
  'Kürtçe',
  'Kürt',
]

export interface ProperNouns {
  // Capitalized wherever they appear: languages, peoples.
  always: string[]
  // Capitalized only in a specific date (TDK madde Ç): day and month names.
  dateOnly: string[]
}

const EMPTY: ProperNouns = { always: [], dateOnly: [] }

const BY_LANGUAGE: Record<string, ProperNouns> = {
  tr: { always: TURKISH_ALWAYS, dateOnly: TURKISH_DATE_ONLY },
}

// Suffixes attach directly to these (Mayıs'ta, Türkçeye), so a prefix match is
// what identifies them, not equality.
export function properNounsFor(locale: Locale): ProperNouns {
  return mergeProperNouns(builtInProperNounsFor(locale), loadLocaleRules(locale)?.properNouns)
}

export function mergeProperNouns(base: ProperNouns, file: { always?: string[]; dateOnly?: string[] } | undefined): ProperNouns {
  // Each list the file names replaces the built-in one; the other is kept, so
  // a file can correct the month names without restating every language name.
  return file ? { always: file.always ?? base.always, dateOnly: file.dateOnly ?? base.dateOnly } : base
}

export function builtInProperNounsFor(locale: Locale): ProperNouns {
  return BY_LANGUAGE[languageOf(locale)] ?? EMPTY
}
