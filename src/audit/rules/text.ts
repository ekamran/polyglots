import type { Locale } from '../../types.js'

// Turkish casing is not the invariant mapping: I lowercases to ı, İ to i. Every
// case comparison in the rules goes through these so the dotted/dotless pairs
// behave, whatever locale is being reviewed.
export function lower(value: string, locale: Locale): string {
  return value.toLocaleLowerCase(locale)
}

export function isUpperFirst(word: string, locale: Locale): boolean {
  const first = [...word][0]
  if (!first || !/\p{L}/u.test(first)) return false
  return first !== lower(first, locale)
}

export function isAcronym(word: string, locale: Locale): boolean {
  const letters = [...word].filter((c) => /\p{L}/u.test(c))
  if (letters.length < 2) return false
  return letters.every((c) => c !== lower(c, locale))
}

// Splits on whitespace and strips surrounding punctuation, so "Changes," and
// "(Sidebar)" compare as words while placeholders and markup fall away.
export function words(value: string): string[] {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/%(?:\d+\$)?(?:[-+ 0#]|'[\s\S])*\d*(?:\.\d+)?[bcdeEfFgGosuxX]/g, ' ')
    .replace(/\{[A-Za-z_][\w.-]*\}|###[A-Za-z0-9_]+###/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
}

export function isTitleCase(value: string, locale: Locale, exempt: (word: string) => boolean): boolean {
  const list = words(value)
  if (list.length < 2) return false
  const countable = list.slice(1).filter((w) => /\p{L}/u.test(w) && !exempt(w) && !isAcronym(w, locale))
  if (countable.length === 0) return false
  return countable.every((w) => isUpperFirst(w, locale))
}

export function capitalizedWords(value: string, locale: Locale, exempt: (word: string) => boolean): string[] {
  return words(value)
    .slice(1)
    .filter((w) => isUpperFirst(w, locale) && !exempt(w) && !isAcronym(w, locale))
}
