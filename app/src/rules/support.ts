import { isUniversalOnly, profileFor } from '../audit/rules/profiles.js'
import type { Locale } from '../types.js'
import { localeDisplayName } from '../wporg/locales.js'
import { loadLocaleRules } from './load.js'
import { packFor } from './packs/index.js'

export interface LocaleSupport {
  pack?: { language: string; status: 'maintained' | 'defaults' }
  // Whether the locale has a rules file. Throws, through the loader, when it
  // has one that does not parse, exactly as a review would.
  file: boolean
  // The rules that will run are the universal ones and nothing else.
  universalOnly: boolean
}

/** What polyglots knows about a locale's language, for the surfaces that say so. */
export function localeSupport(locale: Locale): LocaleSupport {
  const pack = packFor(locale)
  return {
    ...(pack ? { pack: { language: pack.language, status: pack.status } } : {}),
    file: loadLocaleRules(locale) !== undefined,
    universalOnly: isUniversalOnly(profileFor(locale)),
  }
}

/**
 * The one line rules check, the Locale rules screen and the rules edit
 * template all use, so the three cannot describe the same pack differently.
 */
export function packLine(locale: Locale): string {
  const pack = packFor(locale)
  if (!pack) return `No built-in pack for ${locale}: only the universal rules run unless this file adds some.`
  const name = localeDisplayName(pack.language)
  return pack.status === 'maintained'
    ? `Built-in pack: ${name} (maintained)`
    : `Built-in pack: ${name} (defaults for the locale team to confirm)`
}

/**
 * Said before a review or translate whose rules know nothing about the
 * language, so the person reading the output can tell an absent finding from
 * a passed check. Undefined otherwise. Never a refusal: the universal checks
 * are worth running on their own.
 */
export function supportNotice(locale: Locale): string | undefined {
  if (!isUniversalOnly(profileFor(locale))) return undefined
  return `No locale rules for ${locale}; only the universal checks run. Add some with: polyglots rules edit ${locale}`
}
