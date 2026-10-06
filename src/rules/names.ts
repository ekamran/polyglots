// The built-in rules a locale file may switch on or off, by name. Kept here
// rather than read from RULES in audit/rules/index.ts because that module
// imports the profile, which imports the rules file loader, which needs these
// names: reading them from RULES would be a circular import. A test holds this
// list and RULES together.
export const BUILT_IN_RULES = [
  'placeholder',
  'html',
  'plural-count',
  'whitespace',
  'untranslated',
  'escaping',
  'punctuation',
  'line-breaks',
  'ampersand',
  'number-format',
  'title-case',
  'glossary',
  'apostrophe',
  'inconsistent',
  'tm-conflict',
  'control',
] as const

// Mistakes and patterns from a locale file. Never switched on by name: it runs
// whenever the file has any.
export const CUSTOM_RULE = 'custom'
