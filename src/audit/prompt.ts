import type { Finding, Locale } from '../types.js'
import { AUDIT_CATEGORIES } from './schema.js'
import { profileFor } from './rules/profiles.js'

export interface AuditCandidate {
  id: number
  key: string
  msgid: string
  msgctxt?: string
  msgidPlural?: string
  msgstr: string[]
  comments: string[]
  references: string[]
  hints: Finding[]
  // Carries a rules-side mechanical repair through the batch round trip, since
  // toVerdict and unreviewed build a fresh Verdict per candidate and would
  // otherwise lose it.
  repaired?: { text: string[]; repairedBy: 'rules' }
  // Set when the deterministic rules already proved this entry wrong. Its
  // verdict is settled; the model is being asked for a fix, not an opinion.
  condemned?: Finding[]
}

function languageName(locale: Locale): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

export function buildAuditPrompt(candidates: AuditCandidate[], locale: Locale, nplurals: number): string {
  const language = languageName(locale)
  // Orthography guidance follows the locale's profile, not its name. Telling a
  // German reviewer that "German does not use English Title Case" would be false,
  // and would have it flag correct capitalization all day.
  const capitalization = profileFor(locale).rules.has('title-case')
    ? `- ${language} does NOT use English Title Case. Only the first word and proper nouns are capitalized. "Tüm Değişiklikleri Kaydet" is wrong; "Tüm değişiklikleri kaydet" is right. Brand names (WordPress, WooCommerce) and acronyms keep their own casing.
- A capital mid-string is legitimate when the word is a proper noun. In ${language} that includes place and person names, names of languages and peoples, day and month names inside a specific date, titles of works, and institution names, where every word is capitalized (Türk Dil Kurumu). An automated check cannot recognize most of these, so when a title-case finding is really one of them, clear it.
- Menu labels, screen and section names, and section headings in help or documentation pages are a deliberate exception. TDK madde D capitalizes the words of sign-like labels, and the locale team does not reject a submission over capitalization in those places, so do NOT report title-case for them. This exception covers labels and headings only. Commands, buttons, confirmations, error messages and running prose keep sentence case, and an English calque there is still a problem worth reporting.
- The two kinds of title-case check are not equal evidence. A finding that says the translation "mirrors the English source" means the source itself was Title Case and the translation copied its shape word for word; that is close to proof of an English calque. A finding that only says a word is capitalized mid-string is much weaker: measured against approved WordPress ${language} translations it is roughly four times as likely to be a false alarm, and the usual reason is that the capitalized words name a thing, most often a feature, widget, block or key ("Etiket Bulutu bileşeninde", "Hızlı Düzenleme'de göster", "Site Logosu bloğu", "Shift + Ok tuşları"). Check what the capitalized words refer to before confirming that kind.
`
    : `- Follow ${language}'s own capitalization rules. Do not import English conventions, and do not treat a capital that ${language} requires as an error.
`
  const entries = candidates
    .map((c) => {
      const payload: Record<string, unknown> = { id: c.id, source: c.msgid, submitted: c.msgstr }
      if (c.msgctxt) payload.msgctxt = c.msgctxt
      if (c.msgidPlural) payload.sourcePlural = c.msgidPlural
      if (c.comments.length > 0) payload.comments = c.comments
      if (c.references.length > 0) payload.references = c.references
      if (c.hints.length > 0) payload.automatedChecks = c.hints.map((h) => `${h.rule}: ${h.message}`)
      return JSON.stringify(payload)
    })
    .join('\n')

  return `You are the ${language} Locale Manager for WordPress, reviewing translations submitted by contributors to translate.wordpress.org. Many submissions are machine-translated or AI-generated. Your job is triage: decide which entries a human must fix before approval, and let the rest through.

Target locale: ${locale}
nplurals: ${nplurals}

The locale team's standards:
- The official WordPress ${language} glossary is binding. Call glossary_lookup for any term you are unsure about.
${capitalization}- Each entry's "references" are the source file and line the string comes from, and they are the best clue to its role: a path like admin-menu.php or help.php points at a label or a heading, while one like actions.php, or a translation in the imperative, points at a command.
- Placeholders (%s, %1$s, %d, {x}), HTML tags, and leading/trailing whitespace must match the source exactly.
- Use the formal, neutral register standard in WordPress ${language}. No slang, no over-familiar address.
- Call consistency_lookup to see how WordPress core already translates a string, and tm_lookup for previously approved wording. Prefer established usage over a fresh invention.

Some entries carry an "automatedChecks" list: findings from deterministic checks that could not be decided mechanically. ${language} may inflect a glossary term so it no longer matches the dictionary form exactly, and a check may be wrong on that basis. Adjudicate each one: confirm it only if it is a real problem, and clear it otherwise. Entries with no automatedChecks still need your own judgment on meaning, register and fluency.

Mark problem=true only when a human should change the translation before it is approved. Do not flag a translation that is merely different from how you would word it; the bar is "wrong or against the standards", not "not my preference". Every flagged entry costs the reviewer time, so be strict about accuracy but not about taste.

Categories: ${AUDIT_CATEGORIES.join(', ')}. Use an empty array when problem is false. Keep "reason" to one short sentence, written for the contributor, saying what is wrong (or why a flagged check was cleared).

- When an entry is a problem, also return "fix": the corrected translation, as an array with one string per plural form. It must obey every standard above: the glossary, this locale's capitalization rules, the source's placeholders and HTML exactly, and the formal register.
- If you are not confident what the entry should say, leave "fix" out entirely. An honest "I do not know" is worth more than a confident wrong translation, which a human then has to catch.
- Where "automatedChecks" reports a placeholder, html or plural-count problem, the entry is already known to be broken. Do not argue about whether it is wrong; return the fix.

Return exactly one result per id below.

${entries}`
}
