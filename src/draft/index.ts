import type { DraftEngine, DraftEngineChoice, Secrets } from '../types.js'
import { createDeepLEngine, type DeepLClientLike } from './deepl.js'
import { type DraftEngineName } from './errors.js'
import { createOpenAIEngine, type OpenAIClientLike } from './openai.js'
import { createQwenEngine, DEFAULT_QWEN_BASE_URL, DEFAULT_QWEN_MODEL, type QwenClientLike } from './qwen.js'
import type { WarningSink } from './placeholders.js'

export { DraftQuotaError, DraftRateLimitError, type DraftEngineName } from './errors.js'
export { missingPlaceholders, warnMissingPlaceholders, type WarningSink } from './placeholders.js'
export { createDeepLEngine, createOpenAIEngine, createQwenEngine }
export { DEFAULT_QWEN_BASE_URL, DEFAULT_QWEN_MODEL } from './qwen.js'

export interface GetDraftEngineOptions {
  onWarning?: WarningSink
  openaiModel?: string
  deeplClient?: DeepLClientLike
  openaiClient?: OpenAIClientLike
  qwenClient?: QwenClientLike
  // Where the local runner lives and what it should load. Both come from
  // config; the defaults match a stock Ollama install.
  ollama?: { baseUrl?: string; model?: string }
}

// Only the metered engines need a key. The local one needs a runner to be up,
// which is not something a secrets file can promise, so it is checked by
// failing the first call with a message naming the model.
const ENV_VAR: Record<'deepl' | 'openai', keyof Secrets> = {
  deepl: 'DEEPL_API_KEY',
  openai: 'OPENAI_API_KEY',
}

export function getDraftEngine(name: DraftEngineChoice, secrets: Secrets, options: GetDraftEngineOptions = {}): DraftEngine {
  if (name === 'qwen') {
    return createQwenEngine({
      model: options.ollama?.model ?? DEFAULT_QWEN_MODEL,
      baseUrl: options.ollama?.baseUrl ?? DEFAULT_QWEN_BASE_URL,
      ...(options.qwenClient ? { client: options.qwenClient } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    })
  }

  const envVar = ENV_VAR[name]
  if (!envVar) throw new Error(`Unknown draft engine "${String(name)}" (expected "deepl", "openai" or "qwen")`)
  const apiKey = secrets[envVar]?.trim()
  if (!apiKey) {
    throw new Error(`Draft engine "${name}" needs ${envVar}. Set it in the secrets file or environment.`)
  }
  return name === 'deepl'
    ? createDeepLEngine({ apiKey, client: options.deeplClient, onWarning: options.onWarning })
    : createOpenAIEngine({ apiKey, client: options.openaiClient, model: options.openaiModel, onWarning: options.onWarning })
}
