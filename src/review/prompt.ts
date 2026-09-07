import type { Locale, ReviewInput } from '../types.js'

export function localeLabel(locale: Locale): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(locale)
    if (name && name !== locale) return `${name} (${locale})`
  } catch {
    // RangeError for syntactically invalid tags; fall through to the bare code
  }
  return `locale ${locale}`
}

export function buildReviewPrompt(inputs: ReviewInput[], locale: Locale, nplurals: number): string {
  const language = localeLabel(locale)
  const entries = inputs
    .map((input, i) => {
      const entry = {
        id: i + 1,
        msgid: input.msgid,
        ...(input.msgctxt !== undefined ? { msgctxt: input.msgctxt } : {}),
        ...(input.msgidPlural !== undefined ? { msgidPlural: input.msgidPlural } : {}),
        comments: input.comments,
        drafts: input.drafts,
      }
      return `${i + 1}. ${JSON.stringify(entry)}`
    })
    .join('\n')

  return `You are a senior WordPress ${language} translator reviewing machine-translated drafts of WordPress .po entries.
Target locale: ${locale}
nplurals: ${nplurals}

Rules:
- Follow the official WordPress ${language} glossary. Call the glossary_lookup tool for any term that might be in it (WordPress UI vocabulary, post/page/plugin/theme/block/widget terminology, etc.) before deciding on wording.
- Call consistency_lookup when you are unsure how the ${language} community translates a phrase.
- Call tm_lookup to find near-matches in the translation memory and stay consistent with them.
- Preserve placeholders exactly as in the source: %s, %d, %1$s, %2$d, {x}, {{x}}, and similar. Do not add, drop, reorder or reformat them.
- Preserve HTML tags and their attributes exactly.
- Preserve leading/trailing whitespace and newlines exactly as in the source.
- The "text" array must have exactly ${nplurals} strings for entries with msgidPlural (one per plural form, in the locale's plural order), and exactly 1 string otherwise. Never return an empty string.
- Use the formal/neutral register that is standard in WordPress ${language}.
- Do not translate brand names, product names, code, shortcodes, URLs, CSS classes or option keys.
- Use the .po comments and msgctxt to disambiguate; they describe where and how the string is used.

Fuzzy rule:
- Set fuzzy=true ONLY when a competent human should double-check the entry: ambiguous source text, a glossary conflict, uncertain context, or uncertainty about placeholders or HTML.
- Otherwise fuzzy=false. The goal is minimal human review, so do not over-flag. A confident, glossary-compliant translation is not fuzzy.
- Put a short justification in "reason" (why it is fuzzy, or what you checked).

Output:
- Return a JSON object matching the provided schema: { "results": [ { "id", "text", "fuzzy", "reason" } ] }.
- "id" is the integer id of the entry as given below. The output must contain exactly one result per input id, from 1 to ${inputs.length}. No extra ids, no missing ids, no duplicates.

Entries (${inputs.length}):
${entries}
`
}
