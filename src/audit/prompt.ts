import type { Finding, Locale } from '../types.js'
import type { GlossaryMatch } from './rules/index.js'
import { AUDIT_CATEGORIES } from './schema.js'
import { profileFor } from './rules/profiles.js'

const GLOSSARY_LIMIT = 12

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
  // The binding glossary terms this source contains, with their approved
  // translations, resolved before the prompt is built. Carried inline because
  // the alternative is a tool call per term, and an agent that issues those one
  // at a time spends most of a batch on them.
  glossary?: GlossaryMatch[]
  // Every wording this exact source has been translated and approved as, from
  // the local memory. Carried inline for the same reason the glossary terms
  // are: asking costs a round trip, and tm_lookup was 44% of every tool call an
  // agent made. More than one means the locale has approved each of them, so
  // the model is choosing between settled options rather than judging one.
  memory?: readonly string[]
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

/**
 * The prompt for one batch.
 *
 * The entry count is stated rather than left to be counted, which is a line of
 * text bought with a lost batch of a hundred: antigravity pasted all 32KB of
 * one into a python heredoc whose entire body was len(lines), asked for a
 * shell headless mode cannot grant, was soft-denied and produced nothing at
 * all. It happened at batch size 50 as well, where the same instinct reached
 * for a scratch file to validate its own output, so it is not a property of
 * large batches. An agent told the number has no reason to derive it.
 *
 * The count differs between batches while the per-entry cache key does not,
 * which is deliberate and matches batchSize being left out of the review
 * fingerprint: how many entries sit beside an entry cannot change whether that
 * entry's own translation is wrong. What this wording does change is the
 * configuration hash, through fingerprintReview, so editing it prunes the
 * cached verdicts for the locale. That is the intended cost of changing the
 * question.
 */
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
      // The mechanical repair is a decided fact, not an open check. Listing it
      // here would ask the model to adjudicate the one finding that needs no
      // adjudication, and invite a fix for an entry that already has one.
      const checks = c.hints.filter((h) => h.rule !== 'repaired')
      if (checks.length > 0) payload.automatedChecks = checks.map((h) => `${h.rule}: ${h.message}`)
      // Capped, because a long source can touch a dozen terms and the list is
      // repeated for every entry in the batch. The cap is generous enough that
      // hitting it means the string is long enough for the model to ask.
      if (c.glossary && c.glossary.length > 0) {
        payload.glossary = Object.fromEntries(c.glossary.slice(0, GLOSSARY_LIMIT).map((g) => [g.term, g.translations]))
      }
      if (c.memory && c.memory.length > 0) payload.memory = c.memory
      if (c.repaired) payload.alreadyRepaired = true
      // Carried as a field rather than named as a list of rules in the guidance
      // below, so adding an error rule keeps the instruction true on its own.
      if (c.condemned) payload.condemned = true
      return JSON.stringify(payload)
    })
    .join('\n')

  return `You are the ${language} Locale Manager for WordPress, reviewing translations submitted by contributors to translate.wordpress.org. Many submissions are machine-translated or AI-generated. Your job is triage: decide which entries a human must fix before approval, and let the rest through.

Target locale: ${locale}
nplurals: ${nplurals}

The locale team's standards:
- The official WordPress ${language} glossary is binding. Every glossary term an entry's source contains is listed on that entry under "glossary", with its approved translation, so you do not need to look those up. Call glossary_lookup only for a term you need that is not listed there.
${capitalization}- Each entry's "references" are the source file and line the string comes from, and they are the best clue to its role: a path like admin-menu.php or help.php points at a label or a heading, while one like actions.php, or a translation in the imperative, points at a command.
- Placeholders (%s, %1$s, %d, {x}), HTML tags, and leading/trailing whitespace must match the source exactly.
- Use the formal, neutral register standard in WordPress ${language}. No slang, no over-familiar address.
- An entry's "memory" lists how this exact source has been translated and approved before, and every wording in it is already approved. Prefer one of them unless the source means something different here, or it breaks one of the standards above; where there are several, they are alternatives the locale accepts and any of them is a correct answer. You do not need tm_lookup for an entry that has one; call it only for near matches to an entry that has none. Call consistency_lookup to see how WordPress core already translates a string. Prefer established usage over a fresh invention.

Some entries carry an "automatedChecks" list: findings from deterministic checks that could not be decided mechanically. ${language} may inflect a glossary term so it no longer matches the dictionary form exactly, and a check may be wrong on that basis. Adjudicate each one: confirm it only if it is a real problem, and clear it otherwise. Entries with no automatedChecks still need your own judgment on meaning, register and fluency.

An entry marked "alreadyRepaired" had its leading and trailing whitespace restored to match the source before it reached you. That part is settled and is not yours to weigh: judge the translation as it now stands.

Mark problem=true only when a human should change the translation before it is approved. Do not flag a translation that is merely different from how you would word it; the bar is "wrong or against the standards", not "not my preference". Every flagged entry costs the reviewer time, so be strict about accuracy but not about taste.

Categories: ${AUDIT_CATEGORIES.join(', ')}. Use an empty array when problem is false. Keep "reason" to one short sentence, written for the contributor, saying what is wrong (or why a flagged check was cleared).

- When an entry is a problem, also return "fix": the corrected translation, as an array with one string per plural form. It must obey every standard above: the glossary, this locale's capitalization rules, the source's placeholders and HTML exactly, and the formal register.
- If you are not confident what the entry should say, leave "fix" out entirely. An honest "I do not know" is worth more than a confident wrong translation, which a human then has to catch.
- An entry marked "condemned" has been proved wrong by a deterministic check, so it is already known to be broken whatever you think of it. Do not argue about whether it is wrong; return the fix.

There are ${candidates.length} entries below, with ids 1 to ${candidates.length}. Return exactly that many results, one per id. The count is stated so that nothing has to work it out: this prompt and the three lookup tools are everything you have. There is no shell and no filesystem, and reaching for one ends the batch with no output at all.

${entries}`
}
