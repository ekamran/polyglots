import type { Finding, Locale } from '../types.js'
import { AUDIT_CATEGORIES } from './schema.js'

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
- ${language} does NOT use English Title Case. Only the first word and proper nouns are capitalized. "Tüm Değişiklikleri Kaydet" is wrong; "Tüm değişiklikleri kaydet" is right. Brand names (WordPress, WooCommerce) and acronyms keep their own casing.
- A capital mid-string is legitimate when the word is a proper noun. In ${language} that includes place and person names, names of languages and peoples, day and month names inside a specific date, titles of works, and institution names, where every word is capitalized (Türk Dil Kurumu). An automated check cannot recognize most of these, so when a title-case finding is really one of them, clear it.
- Menu labels, screen and section names, and section headings in help or documentation pages are a deliberate exception. TDK madde D capitalizes the words of sign-like labels, and the locale team does not reject a submission over capitalization in those places, so do NOT report title-case for them. This exception covers labels and headings only. Commands, buttons, confirmations, error messages and running prose keep sentence case, and an English calque there is still a problem worth reporting.
- Each entry's "references" are the source file and line the string comes from, and they are the best clue to its role: a path like admin-menu.php or help.php points at a label or a heading, while one like actions.php, or a translation in the imperative, points at a command.
- Placeholders (%s, %1$s, %d, {x}), HTML tags, and leading/trailing whitespace must match the source exactly.
- Use the formal, neutral register standard in WordPress ${language}. No slang, no over-familiar address.
- Call consistency_lookup to see how WordPress core already translates a string, and tm_lookup for previously approved wording. Prefer established usage over a fresh invention.

Some entries carry an "automatedChecks" list: findings from deterministic checks that could not be decided mechanically. ${language} is agglutinative, so a glossary term carrying suffixes (kenar çubuğu -> kenar çubuğunu) is still correct, and a check may be wrong. Adjudicate each one: confirm it only if it is a real problem, and clear it otherwise. Entries with no automatedChecks still need your own judgment on meaning, register and fluency.

Mark problem=true only when a human should change the translation before it is approved. Do not flag a translation that is merely different from how you would word it; the bar is "wrong or against the standards", not "not my preference". Every flagged entry costs the reviewer time, so be strict about accuracy but not about taste.

Categories: ${AUDIT_CATEGORIES.join(', ')}. Use an empty array when problem is false. Keep "reason" to one short sentence, written for the contributor, saying what is wrong (or why a flagged check was cleared).

Return exactly one result per id below.

${entries}`
}
