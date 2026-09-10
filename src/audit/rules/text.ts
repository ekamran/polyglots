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

// An acronym keeps its shape when Turkish attaches a suffix through an
// apostrophe (PDF'yi, URL'sini), so only the stem before the apostrophe counts.
export function acronymStem(word: string): string {
  const at = word.search(/['’]/)
  return at === -1 ? word : word.slice(0, at)
}

export function isAcronym(word: string, locale: Locale): boolean {
  const letters = [...acronymStem(word)].filter((c) => /\p{L}/u.test(c))
  if (letters.length < 2) return false
  return letters.every((c) => c !== lower(c, locale))
}

function strip(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/%(?:\d+\$)?(?:[-+ 0#]|'[\s\S])*\d*(?:\.\d+)?[bcdeEfFgGosuxX]/g, ' ')
    .replace(/\{[A-Za-z_][\w.-]*\}|###[A-Za-z0-9_]+###/g, ' ')
}

function clean(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// Splits on whitespace and strips surrounding punctuation, so "Changes," and
// "(Sidebar)" compare as words while placeholders and markup fall away.
export function words(value: string): string[] {
  return strip(value).split(/\s+/).map(clean).filter(Boolean)
}

// Turkish capitalizes the first word of every sentence, not just the first word
// of the string, so a run-on UI string legitimately has several capitals.
const SENTENCE_END = /[.!?:;…]$/

export function nonInitialWords(value: string): string[] {
  const out: string[] = []
  let atSentenceStart = true

  for (const raw of strip(value).split(/\s+/)) {
    if (!raw) continue
    const word = clean(raw)
    if (word) {
      if (!atSentenceStart) out.push(word)
      atSentenceStart = false
    }
    if (SENTENCE_END.test(raw)) atSentenceStart = true
  }
  return out
}

export function isTitleCase(value: string, locale: Locale, exempt: (word: string) => boolean): boolean {
  if (words(value).length < 2) return false
  const countable = nonInitialWords(value).filter((w) => /\p{L}/u.test(w) && !exempt(w) && !isAcronym(w, locale))
  if (countable.length === 0) return false
  return countable.every((w) => isUpperFirst(w, locale))
}

export function capitalizedWords(value: string, locale: Locale, exempt: (word: string) => boolean): string[] {
  return nonInitialWords(value).filter((w) => isUpperFirst(w, locale) && !exempt(w) && !isAcronym(w, locale))
}
