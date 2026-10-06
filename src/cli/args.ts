import { existsSync, globSync, statSync } from 'node:fs'
import { resolveLocale, suggestLocales } from '../wporg/locales.js'
import { resolve } from 'node:path'
import type { CsvDelimiter } from '../commands/glossary-export.js'
import { isReviewProvider, PROVIDERS } from '../agent/providers.js'
import type { Locale, ReviewProvider, Secrets } from '../types.js'

export class UsageError extends Error {
  readonly exitCode = 2
}

const GLOB_MAGIC = /[*?[\]{}]/

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function expandFileArgs(patterns: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (file: string) => {
    const key = resolve(file)
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }

  for (const pattern of patterns) {
    if (existsSync(pattern)) {
      if (!isFile(pattern)) throw new UsageError(`Not a file: ${pattern}`)
      push(pattern)
      continue
    }
    if (!GLOB_MAGIC.test(pattern)) throw new UsageError(`File not found: ${pattern}`)
    const matches = globSync(pattern).filter(isFile).sort()
    if (matches.length === 0) throw new UsageError(`No files match "${pattern}"`)
    for (const match of matches) push(match)
  }
  return out
}

export function parsePositiveInt(flag: string, raw: string): number {
  const value = Number(raw)
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(value) || value <= 0) {
    throw new UsageError(`${flag} must be a positive integer, got "${raw}"`)
  }
  return value
}

// Whatever a translator types (nl_NL_formal, nl-be, nl/formal) becomes the id
// polyglots uses: the wp.org slug, plus the translation set when it is not the
// default. The mapping is wp.org's own table, shipped with the build, because
// it cannot be computed: nl_NL is "nl" while nl_BE is "nl-be".
export function parseLocaleArg(raw: string): Locale {
  if (raw.trim() === '') throw new UsageError('--locale must not be empty')
  const resolved = resolveLocale(raw)
  if (resolved) return resolved.id
  const near = suggestLocales(raw)
  throw new UsageError(
    `Locale "${raw.trim()}" is not listed on translate.wordpress.org` + (near.length ? `; did you mean ${near.join(', ')}?` : ''),
  )
}

const SECRET_NAMES: ReadonlyArray<keyof Secrets> = ['DEEPL_API_KEY', 'OPENAI_API_KEY']

export function isSecretName(name: string): name is keyof Secrets {
  return (SECRET_NAMES as readonly string[]).includes(name)
}

export function parseSecretName(raw: string): keyof Secrets {
  if (isSecretName(raw)) return raw
  throw new UsageError(`Unknown key "${raw}"; expected one of ${SECRET_NAMES.join(', ')}`)
}

export const DRAFT_ENGINES = ['deepl', 'openai', 'qwen'] as const

export type DraftEngineChoice = (typeof DRAFT_ENGINES)[number]

export function parseDraftEngine(raw: string): DraftEngineChoice {
  if (raw === 'deepl' || raw === 'openai' || raw === 'qwen') return raw
  throw new UsageError(`--draft-engine must be one of ${DRAFT_ENGINES.join(', ')}, got "${raw}"`)
}

// Named for the setting rather than a flag: there is no --review-provider, so
// the only way in is `polyglots config set reviewProvider`, or the menu.
export function parseReviewProvider(raw: string): ReviewProvider {
  if (isReviewProvider(raw)) return raw
  throw new UsageError(`reviewProvider must be one of ${PROVIDERS.join(', ')}, got "${raw}"`)
}

export function parseCsvDelimiter(raw: string): CsvDelimiter {
  if (raw === ';' || raw === ',') return raw
  throw new UsageError(`--delimiter must be ";" or ",", got "${raw}"`)
}

// `qwen` is deliberately absent: a local runner needs no secret, and mapping it
// to one would make the precheck demand a key that can never exist.
const ENGINE_SECRET: Record<DraftEngineChoice, keyof Secrets | undefined> = {
  deepl: 'DEEPL_API_KEY',
  openai: 'OPENAI_API_KEY',
  qwen: undefined,
}

export function secretForEngine(engine: DraftEngineChoice): keyof Secrets | undefined {
  return ENGINE_SECRET[engine]
}
