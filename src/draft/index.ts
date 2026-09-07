import type { DraftEngine, Secrets } from '../types.js'
import { createDeepLEngine, type DeepLClientLike } from './deepl.js'
import { type DraftEngineName } from './errors.js'
import { createOpenAIEngine, type OpenAIClientLike } from './openai.js'
import type { WarningSink } from './placeholders.js'

export { DraftQuotaError, DraftRateLimitError, type DraftEngineName } from './errors.js'
export { missingPlaceholders, warnMissingPlaceholders, type WarningSink } from './placeholders.js'
export { createDeepLEngine, createOpenAIEngine }

export interface GetDraftEngineOptions {
  onWarning?: WarningSink
  openaiModel?: string
  deeplClient?: DeepLClientLike
  openaiClient?: OpenAIClientLike
}

const ENV_VAR: Record<DraftEngineName, keyof Secrets> = {
  deepl: 'DEEPL_API_KEY',
  openai: 'OPENAI_API_KEY',
}

export function getDraftEngine(name: DraftEngineName, secrets: Secrets, options: GetDraftEngineOptions = {}): DraftEngine {
  const envVar = ENV_VAR[name]
  if (!envVar) throw new Error(`Unknown draft engine "${String(name)}" (expected "deepl" or "openai")`)
  const apiKey = secrets[envVar]?.trim()
  if (!apiKey) {
    throw new Error(`Draft engine "${name}" needs ${envVar}. Set it in the secrets file or environment.`)
  }
  return name === 'deepl'
    ? createDeepLEngine({ apiKey, client: options.deeplClient, onWarning: options.onWarning })
    : createOpenAIEngine({ apiKey, client: options.openaiClient, model: options.openaiModel, onWarning: options.onWarning })
}
