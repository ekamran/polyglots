import { languageOf } from '../../wporg/locales.js'
import type { Locale } from '../../types.js'
import { sv } from './sv.js'
import { tr } from './tr.js'
import type { LocalePack } from './types.js'

export type { LocalePack } from './types.js'

// Every pack polyglots ships. A language joins only when someone who speaks it
// supplies the data, and stays `defaults` until its locale team confirms it.
export const PACKS: readonly LocalePack[] = [tr, sv]

const BY_LANGUAGE = new Map(PACKS.map((p) => [p.language, p]))

/**
 * The pack for a locale, by language: nl/formal and nl-be would both read an
 * nl pack. Undefined for a language with none, which runs the universal rules
 * and the default prompt text.
 */
export function packFor(locale: Locale): LocalePack | undefined {
  return BY_LANGUAGE.get(languageOf(locale))
}
