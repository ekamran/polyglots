import { existsSync, readFileSync } from 'node:fs'
import { usableProviders, type AgentStatus } from '../agent/discover.js'
import { loadLocaleRules } from '../rules/load.js'
import { configFile, dbFile } from '../paths.js'
import { allGlossary } from '../storage/glossary.js'
import type { GlossaryEntry, Locale, PolyglotsConfig, Secrets } from '../types.js'
import { SETUP_STEPS, type SetupStep, type TuiState } from './state.js'
import { readOnly } from '../storage/read-only.js'

// The five setup steps and whether each is done, worked out in one place so
// the header's x/5 and the wizard can never disagree.

export type StepState = 'done' | 'missing' | 'unknown'

export interface SetupFacts {
  config: PolyglotsConfig
  secrets: Secrets
  state: TuiState
  // Undefined while discovery runs or after it failed.
  agents?: AgentStatus[]
  localeConfigured: boolean
  // Undefined when the memory could not be read.
  glossaryCount?: number
  hasLocaleRules: boolean
}

export interface SetupStatus {
  steps: Record<SetupStep, StepState>
  done: number
  total: number
}

export const STEP_LABELS: Record<SetupStep, string> = {
  locale: 'locale',
  provider: 'provider',
  keys: 'keys',
  glossary: 'glossary',
  rules: 'rules',
}

export function setupStatus(f: SetupFacts): SetupStatus {
  const confirmed = (s: SetupStep) => f.state.wizard.confirmed.includes(s)
  const skipped = (s: SetupStep) => f.state.wizard.skipped.includes(s)
  const steps: Record<SetupStep, StepState> = {
    // Whether the person chose a locale, read off config.json itself. The
    // defaults used to name tr, which made a fresh install read as done; they
    // name none now, but the file stays the authority, since the config here
    // falls back to the defaults when the file cannot be read.
    locale: f.localeConfigured || confirmed('locale') ? 'done' : 'missing',
    // The local reviewer is only ever chosen on purpose, by config set, so it
    // counts as configured. An agent counts once discovery says it is usable;
    // until discovery answers the step is unknown rather than missing, so the
    // count does not flicker down and back up at every launch.
    provider:
      f.config.reviewProvider === 'local'
        ? 'done'
        : f.agents === undefined
          ? 'unknown'
          : usableProviders(f.agents).includes(f.config.reviewProvider)
            ? 'done'
            : 'missing',
    // Keys are optional: someone who drafts locally, or never drafts, has
    // nothing to set, and a step they can never finish would hold the count
    // at 4/5 and reopen the wizard at every launch.
    keys:
      Boolean(f.secrets.DEEPL_API_KEY) || Boolean(f.secrets.OPENAI_API_KEY) || f.config.defaultDraftEngine === 'local' || skipped('keys')
        ? 'done'
        : 'missing',
    glossary: f.glossaryCount === undefined ? 'missing' : f.glossaryCount > 0 ? 'done' : 'missing',
    rules: f.hasLocaleRules ? 'done' : 'missing',
  }
  const done = SETUP_STEPS.filter((s) => steps[s] === 'done').length
  return { steps, done, total: SETUP_STEPS.length }
}

/** Whether config.json names a locale itself, rather than leaving the default. */
export function localeConfigured(): boolean {
  try {
    const path = configFile()
    if (!existsSync(path)) return false
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && typeof (parsed as { defaultLocale?: unknown }).defaultLocale === 'string'
  } catch {
    return false
  }
}

/**
 * Glossary rows for a locale, counted without writing (see readOnly).
 * Undefined when there is no database or it cannot be read, which the status
 * shows as not synced.
 */
export function glossaryCount(locale: Locale, path: string = dbFile()): number | undefined {
  return readOnly(
    path,
    (db) => (db.prepare('SELECT COUNT(*) AS n FROM glossary WHERE locale = ?').get(locale) as { n: number }).n,
    undefined,
  )
}

/**
 * A locale's glossary rows, read the same way, for the Locale Rules trial so
 * the glossary rule fires in a trial too. Empty when there is no database or
 * it cannot be read, which leaves the trial without the glossary rule rather
 * than without a trial.
 */
export function glossaryRows(locale: Locale, path: string = dbFile()): GlossaryEntry[] {
  return readOnly(path, (db) => allGlossary(db, locale), [])
}

/** Whether the locale has a rules file. An invalid one still counts: it exists, and its screen says what is wrong. */
export function hasLocaleRules(locale: Locale): boolean {
  try {
    return loadLocaleRules(locale) !== undefined
  } catch {
    return true
  }
}
