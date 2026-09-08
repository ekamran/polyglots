import { existsSync, globSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeLocale } from '../tmx/parse.js'
import type { CsvDelimiter } from '../commands/glossary-export.js'
import type { Locale, Secrets } from '../types.js'

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

// translate.wordpress.org slugs are "tr", "pt-br", "zh-cn"; a WordPress locale code such as
// "tr_TR" would silently produce empty glossary/consistency results and a TM locale nobody imported.
export function parseLocaleArg(raw: string): Locale {
  const locale = normalizeLocale(raw)
  if (!locale) throw new UsageError('--locale must not be empty')
  const [language, region, ...rest] = locale.split('-')
  const looksLikeWpCode = raw.includes('_') || (region !== undefined && region === language) || rest.length > 0
  if (looksLikeWpCode) {
    throw new UsageError(
      `Locale "${raw.trim()}" is not a translate.wordpress.org slug; use "${language}" (or a regional slug such as pt-br)`,
    )
  }
  return locale
}

const SECRET_NAMES: ReadonlyArray<keyof Secrets> = ['DEEPL_API_KEY', 'OPENAI_API_KEY']

export function isSecretName(name: string): name is keyof Secrets {
  return (SECRET_NAMES as readonly string[]).includes(name)
}

export function parseSecretName(raw: string): keyof Secrets {
  if (isSecretName(raw)) return raw
  throw new UsageError(`Unknown key "${raw}"; expected one of ${SECRET_NAMES.join(', ')}`)
}

export const DRAFT_ENGINES = ['deepl', 'openai'] as const

export type DraftEngineName = (typeof DRAFT_ENGINES)[number]

export function parseDraftEngine(raw: string): DraftEngineName {
  if (raw === 'deepl' || raw === 'openai') return raw
  throw new UsageError(`--draft-engine must be one of ${DRAFT_ENGINES.join(', ')}, got "${raw}"`)
}

export function parseCsvDelimiter(raw: string): CsvDelimiter {
  if (raw === ';' || raw === ',') return raw
  throw new UsageError(`--delimiter must be ";" or ",", got "${raw}"`)
}

const ENGINE_SECRET: Record<DraftEngineName, keyof Secrets> = {
  deepl: 'DEEPL_API_KEY',
  openai: 'OPENAI_API_KEY',
}

export function secretForEngine(engine: DraftEngineName): keyof Secrets {
  return ENGINE_SECRET[engine]
}
