import { loadLocaleRules } from '../../rules/load.js'
import { packFor } from '../../rules/packs/index.js'
import type { Locale } from '../../types.js'

export interface ProperNouns {
  // Capitalized wherever they appear: languages, peoples.
  always: readonly string[]
  // Capitalized only in a specific date (TDK madde Ç): day and month names.
  dateOnly: readonly string[]
}

const EMPTY: ProperNouns = { always: [], dateOnly: [] }

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

// The pack's lists, which for Turkish are the TDK categories a brand
// allowlist does not cover. A language without a pack exempts nothing beyond
// the brands the rule context learns from the file.
export function builtInProperNounsFor(locale: Locale): ProperNouns {
  return packFor(locale)?.properNouns ?? EMPTY
}
