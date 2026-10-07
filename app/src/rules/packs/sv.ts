import type { LocalePack } from './types.js'

// Swedish: defaults pending confirmation by the sv locale team, not rules
// they have agreed to. Written from the WordPress Swedish style guide
// (https://sv.wordpress.org/team/handbook/stilguide/) and Språkrådet's
// recommendations, by someone who does not review Swedish. Until the team
// signs it off its status stays `defaults`, which rules check, the Locale
// rules screen and the rules edit template all say out loud.
//
// Only `title-case` beyond the universal set. `apostrophe`, `ampersand` and
// `number-format` are Turkish conventions in rule form: the suffix apostrophe,
// the conjunction written out, the percent sign before the number. Swedish
// does none of those the same way, so turning them on would invent findings.
//
// No proper nouns. Swedish writes languages, nationalities, days and months in
// lower case (svenska, engelsk, måndag, januari), so there is nothing to
// exempt, and a capital mid-sentence in the English source is already learned
// as a brand by the rule context.

const CAPITALIZATION = `- {language} uses sentence case, not English Title Case. Only the first word and proper nouns are capitalized: "Spara Alla Ändringar" is wrong; "Spara alla ändringar" is right. Brand names (WordPress, WooCommerce) and acronyms keep their own casing.
- {language} writes the names of languages, nationalities, days of the week and months in lower case (svenska, engelsk, måndag, januari), even where English capitalizes them. A capital on one of those mid-sentence is an English calque.
- The two kinds of title-case check are not equal evidence. A finding that says the translation "mirrors the English source" means the source itself was Title Case and the translation copied its shape word for word; that is close to proof of an English calque. A finding that only says a word is capitalized mid-string is weaker: check whether the word is a proper noun or a brand before confirming it.
`

export const sv: LocalePack = {
  language: 'sv',
  status: 'defaults',
  extraRules: ['title-case'],
  glossaryStemRatio: 0.7,
  properNouns: { always: [], dateOnly: [] },
  capitalization: CAPITALIZATION,
  // WordPress in Swedish speaks to the reader as "du". The default line asks
  // for a formal register with no over-familiar address, which reads as an
  // invitation to "ni": a wrong fix, written into a contributor's work.
  register: {
    audit: '- Address the reader as "du", as WordPress in {language} does, and do not use "ni" as a polite form. Keep the register neutral and concise, with no slang.',
    translate: '- Address the reader as "du", as WordPress in {language} does, and do not use "ni" as a polite form. Keep the register neutral and concise, with no slang.',
  },
  // Hints, every one, because none of them is a rule the team has agreed to.
  examples: {
    mistakes: [
      '  - wrong: lösen ord',
      '    right: lösenord',
      '    note: Compound words are written as one word, not split (särskrivning). Confirm with your team.',
    ],
    patterns: [
      `  - find: "\\\\p{L}'s\\\\b"`,
      '    level: hint',
      "    note: English-style genitive apostrophe (WordPress's), which Swedish does not use. Confirm with your team.",
      "  - find: '\\d%'",
      '    level: hint',
      '    note: Språkrådet writes a space before the percent sign (25 %). Confirm with your team.',
    ],
  },
}
