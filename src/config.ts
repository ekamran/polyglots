import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseDotenv } from 'dotenv'
import { z } from 'zod'
import { configFile, secretsFile } from './paths.js'
import type { PolyglotsConfig, Secrets } from './types.js'

export const DEFAULT_CONFIG: PolyglotsConfig = {
  defaultLocale: 'tr',
  defaultDraftEngine: 'deepl',
  batchSize: 25,
  consistencyTtlDays: 30,
  properNouns: {},
}

const configSchema = z.object({
  defaultLocale: z.string().min(1),
  defaultDraftEngine: z.enum(['deepl', 'openai']),
  batchSize: z.number().int().positive(),
  consistencyTtlDays: z.number().int().nonnegative(),
  properNouns: z.record(z.string(), z.array(z.string())),
})

const SECRET_KEYS: ReadonlyArray<keyof Secrets> = ['DEEPL_API_KEY', 'OPENAI_API_KEY']

function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  chmodSync(path, 0o600)
}

function readConfigFile(): Record<string, unknown> {
  const path = configFile()
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON in config file ${path}: ${detail}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file ${path} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function validate(candidate: Record<string, unknown>): PolyglotsConfig {
  const result = configSchema.safeParse(candidate)
  if (result.success) return result.data
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
  throw new Error(`Invalid config in ${configFile()}: ${issues}`)
}

export function loadConfig(): PolyglotsConfig {
  return validate({ ...DEFAULT_CONFIG, ...readConfigFile() })
}

export function saveConfig(patch: Partial<PolyglotsConfig>): PolyglotsConfig {
  const fromFile = readConfigFile()
  const merged = validate({ ...DEFAULT_CONFIG, ...fromFile, ...patch })
  writePrivate(configFile(), JSON.stringify({ ...fromFile, ...merged }, null, 2) + '\n')
  return merged
}

function readSecretsFile(): Record<string, string> {
  const path = secretsFile()
  if (!existsSync(path)) return {}
  return parseDotenv(readFileSync(path, 'utf8'))
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined
}

export function loadSecrets(): Secrets {
  const fromFile = readSecretsFile()
  const secrets: Secrets = {}
  for (const key of SECRET_KEYS) {
    secrets[key] = nonEmpty(process.env[key]) ?? nonEmpty(fromFile[key])
  }
  return secrets
}

function formatDotenvValue(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Secret value cannot contain control characters such as newlines')
  }
  if (!/[\s#"'`]/.test(value)) return value
  // dotenv strips wrapping quotes but does not unescape, so pick a quote the value lacks.
  // Double quotes come last because dotenv expands \n and \r inside them.
  for (const quote of ["'", '`']) {
    if (!value.includes(quote)) return `${quote}${value}${quote}`
  }
  if (value.includes('"')) {
    throw new Error('Secret value cannot contain single, double and backtick quotes at once')
  }
  if (/\\[nr]/.test(value)) {
    throw new Error('Secret value cannot contain a backslash-n or backslash-r escape together with both single and backtick quotes')
  }
  return `"${value}"`
}

export function saveSecret(name: keyof Secrets, value: string): void {
  const path = secretsFile()
  const line = `${name}=${formatDotenvValue(value)}`
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*[=:]`)

  const lines = existing.length > 0 ? existing.split(/\r?\n/) : []
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  // dotenv is last-wins, so later duplicates must go or they would shadow the new value.
  let replaced = false
  const next = lines.flatMap((current) => {
    if (!keyPattern.test(current)) return [current]
    if (replaced) return []
    replaced = true
    return [line]
  })
  if (!replaced) next.push(line)

  writePrivate(path, next.join('\n') + '\n')
}

export function maskSecret(value?: string): string {
  if (!value) return '(not set)'
  if (value.length < 12) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}
