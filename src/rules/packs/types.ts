/**
 * What polyglots ships for one language before any rules file: the rules that
 * run beyond the universal set, the proper nouns the title-case rule exempts,
 * and the few lines of prompt text that only someone who speaks the language
 * can write.
 *
 * Data only. A pack that needed logic would be a rule, and rules live in
 * audit/rules where every locale can switch them on by name. Typed TypeScript
 * rather than YAML read at runtime, because the build is bare tsc: a YAML pack
 * would need a copy step into dist/, a path resolved relative to the compiled
 * module and a files list in package.json, three new ways to ship a broken
 * install for nothing the person using it would notice. test/rules/packs.test.ts
 * holds every pack to the limits a user's file is held to.
 */
export interface LocalePack {
  // languageOf() of the locales it serves: tr serves tr, sv serves sv and any
  // set of it.
  language: string
  // `maintained`: a locale team stands behind it. `defaults`: written from the
  // published style guide, waiting for the team to confirm it. Shown in rules
  // check, the Locale rules screen and the rules edit template, and never
  // rendered into a prompt, so it is no part of any cache key.
  status: 'maintained' | 'defaults'
  // Beyond the universal set, in the order they are listed in the template.
  extraRules: readonly string[]
  glossaryStemRatio: number
  properNouns: { always: readonly string[]; dateOnly: readonly string[] }
  // The audit prompt's capitalization bullets when title-case runs, each line
  // starting "- " and ending in a newline. `{language}` is replaced with the
  // locale's display name. Absent, a locale that turns title-case on gets the
  // generic sentence-case paragraph instead.
  capitalization?: string
  // Replaces the register line of each review prompt. `{language}` as above,
  // rendered with what each prompt calls the language. Absent, both keep the
  // formal, neutral line every locale has always had.
  register?: { audit: string; translate: string }
  // YAML lines for the rules edit template, written uncommented and commented
  // out when rendered, so the team opts in by deleting the '#'. Never applied
  // on their own: a pack that contributed patterns would need merge and
  // disable rules for them, and "a pack you never touched changes nothing but
  // its profile" is easier to reason about.
  examples?: { mistakes: readonly string[]; patterns: readonly string[] }
}
