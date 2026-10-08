import type { DraftEngine, DraftEngineChoice, LocalServerKind, Secrets } from '../types.js'
import { createDeepLEngine, type DeepLClientLike } from './deepl.js'
import { type DraftEngineName } from './errors.js'
import { createOpenAIEngine, type OpenAIClientLike } from './openai.js'
import { createLocalTargetEngine, createQwenEngine, DEFAULT_QWEN_BASE_URL, DEFAULT_QWEN_MODEL, type QwenClientLike } from './qwen.js'
import { localModelId, type LocalChat, type LocalTarget } from './local-chat.js'
import type { WarningSink } from './placeholders.js'

export { DraftQuotaError, DraftRateLimitError, type DraftEngineName } from './errors.js'
export { missingPlaceholders, warnMissingPlaceholders, type WarningSink } from './placeholders.js'
export { createDeepLEngine, createOpenAIEngine, createQwenEngine }
export { DEFAULT_QWEN_BASE_URL, DEFAULT_QWEN_MODEL } from './qwen.js'
export { localModelId, resolveLocalTarget, type LocalChat, type LocalTarget } from './local-chat.js'

/**
 * A draft engine name as a person may have typed or saved it: the choice, or
 * `qwen`, which is what `local` was called until 0.23.
 */
export type DraftEngineInput = DraftEngineChoice | 'qwen'

/** The choice a typed or saved name means, or undefined for an unknown one. */
export function normalizeDraftEngine(raw: string): DraftEngineChoice | undefined {
  if (raw === 'qwen' || raw === 'local') return 'local'
  if (raw === 'deepl' || raw === 'openai' || raw === 'none') return raw
  return undefined
}

/**
 * Which local server and model, as far as the caller knows. `kind` defaults to
 * Ollama, which is what every caller from before there was a second kind
 * means when it passes `{ model }` alone.
 */
export interface LocalTargetInput {
  kind?: LocalServerKind
  baseUrl?: string
  model?: string
}

export interface GetDraftEngineOptions {
  onWarning?: WarningSink
  openaiModel?: string
  deeplClient?: DeepLClientLike
  openaiClient?: OpenAIClientLike
  qwenClient?: QwenClientLike
  // Where the local runner lives and what it should load. Both come from
  // config; the defaults match a stock Ollama install.
  ollama?: { baseUrl?: string; model?: string; contextLength?: number }
  // The resolved local target, of either kind. Wins over `ollama` when given.
  local?: LocalTarget
  // Stands in for the local transport, for tests.
  localChat?: LocalChat
  // How long the local server may be silent; see localIdleTimeoutMs.
  idleTimeoutMs?: number
}

// Only the metered engines need a key. The local one needs a runner to be up,
// which is not something a secrets file can promise, so it is checked by
// failing the first call with a message naming the model.
const ENV_VAR: Record<'deepl' | 'openai', keyof Secrets> = {
  deepl: 'DEEPL_API_KEY',
  openai: 'OPENAI_API_KEY',
}

/**
 * What an engine built from these inputs will call itself.
 *
 * Derivable without building one, because the draft cache key and the run row
 * are both written before the engine exists: construction is deferred until
 * there is a batch to translate, so that a fully cached run needs no API key
 * and no reachable Ollama. Reading the name off a constructed engine would
 * trade that away.
 *
 * Kept beside `getDraftEngine` so the two cannot drift. They did: the caller
 * used to fall back to the chosen engine's name when it had no engine to ask,
 * which for the metered engines is the same string and for the local one is
 * not. Every local model was stored as `qwen`, so switching models served one
 * model's drafts as the other's, which is exactly what naming the model was
 * meant to prevent.
 */
export function draftEngineId(name: DraftEngineInput, local?: LocalTargetInput): DraftEngineName {
  // `none` drafts nothing, so it has no identity to key a draft under, and a
  // caller asking for one has missed that translate never builds it.
  if (name === 'none') throw new Error('The draft engine "none" drafts nothing and has no engine id')
  if (normalizeDraftEngine(name) !== 'local') return name as 'deepl' | 'openai'
  return localModelId({
    kind: local?.kind ?? 'ollama',
    baseUrl: local?.baseUrl ?? DEFAULT_QWEN_BASE_URL,
    model: local?.model ?? DEFAULT_QWEN_MODEL,
  })
}

export function getDraftEngine(name: DraftEngineInput, secrets: Secrets, options: GetDraftEngineOptions = {}): DraftEngine {
  if (name === 'none') throw new Error('The draft engine "none" drafts nothing; translate fills from the translation memory alone')
  if (normalizeDraftEngine(name) === 'local') {
    const target: LocalTarget = options.local ?? {
      kind: 'ollama',
      baseUrl: options.ollama?.baseUrl ?? DEFAULT_QWEN_BASE_URL,
      model: options.ollama?.model ?? DEFAULT_QWEN_MODEL,
      ...(options.ollama?.contextLength === undefined ? {} : { contextLength: options.ollama.contextLength }),
    }
    // The Ollama-shaped fake that tests from before the second kind inject.
    if (target.kind === 'ollama' && options.qwenClient && !options.localChat) {
      return createQwenEngine({
        model: target.model,
        baseUrl: target.baseUrl,
        ...(target.contextLength === undefined ? {} : { contextLength: target.contextLength }),
        client: options.qwenClient,
        ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      })
    }
    return createLocalTargetEngine(target, {
      ...(options.localChat ? { chat: options.localChat } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    })
  }

  const envVar = ENV_VAR[name as 'deepl' | 'openai']
  if (!envVar) throw new Error(`Unknown draft engine "${String(name)}" (expected "deepl", "openai" or "local")`)
  const apiKey = secrets[envVar]?.trim()
  if (!apiKey) {
    throw new Error(`Draft engine "${name}" needs ${envVar}. Set it in the secrets file or environment.`)
  }
  return name === 'deepl'
    ? createDeepLEngine({ apiKey, client: options.deeplClient, onWarning: options.onWarning })
    : createOpenAIEngine({ apiKey, client: options.openaiClient, model: options.openaiModel, onWarning: options.onWarning })
}
