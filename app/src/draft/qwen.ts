import { z } from 'zod'
import type { DraftEngine, DraftEngineName, DraftResult, Locale, TranslationUnit } from '../types.js'
import { draftSystemPrompt } from './prompt.js'
import { warnMissingPlaceholders, type WarningSink } from './placeholders.js'
import {
  chatFromOllama,
  createLocalChat,
  localModelId,
  ollamaTransport,
  type LocalChat,
  type LocalTarget,
  type QwenClientLike,
} from './local-chat.js'

// The local draft engine: a model on this machine, so a long translate costs
// nothing and has no quota. It is shaped like the OpenAI engine (same prompt,
// same {items} reply, same placeholder warnings) and differs in ways that are
// all consequences of the model running here.
//
// The file keeps the name of the first model it ran. The engine choice is
// `local` since 0.23, and the server can be Ollama or anything that speaks the
// OpenAI chat API; the wire formats are in local-chat.ts, so this file is the
// one copy of the prompt, the parsing and the warnings for both.

export type { QwenChatBody, QwenChatMessage, QwenClientLike } from './local-chat.js'

export interface QwenEngineOptions {
  model: string
  baseUrl?: string
  contextLength?: number
  client?: QwenClientLike
  onWarning?: WarningSink
}

export const DEFAULT_QWEN_BASE_URL = 'http://localhost:11434'
// Ollama runs MLX builds on Apple silicon only. Everywhere else the MLX tag
// fails until the person picks another model, so the default there is the
// plain build of the same model. On a Mac with Apple silicon nothing changes,
// which keeps its draft cache keys (they name the model) as they were.
export function defaultQwenModel(platform: string = process.platform, arch: string = process.arch): string {
  return platform === 'darwin' && arch === 'arm64' ? 'qwen3.8:27b-mlx' : 'qwen3.8:27b'
}

export const DEFAULT_QWEN_MODEL = defaultQwenModel()

// Measured on a 3,656-entry file of short pattern strings: 15 entries per batch
// ran at 1.4s each and 30 at 1.5s, but 60 at 4.6s. Past this the cost per entry
// climbs steeply, so a batch size chosen for the metered engines would quietly
// triple a local run.
export const DEFAULT_QWEN_BATCH_ADVICE = 30

const ResponseSchema = z.object({
  items: z.array(z.object({ id: z.number().int().min(1), drafts: z.array(z.string()).min(1) })),
})

const REPLY_FORMAT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer', minimum: 1 }, drafts: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'drafts'],
      },
    },
  },
  required: ['items'],
} as const

class MalformedOutputError extends Error {
  override readonly name = 'MalformedOutputError'
}

function userPrompt(units: TranslationUnit[]): string {
  // 1-based ids, not keys: see the note in draftSystemPrompt.
  const items = units.map((u, i) => ({
    id: i + 1,
    msgid: u.msgid,
    ...(u.msgctxt !== undefined ? { msgctxt: u.msgctxt } : {}),
    ...(u.msgidPlural !== undefined ? { msgidPlural: u.msgidPlural } : {}),
    ...(u.comments.length > 0 ? { comments: u.comments } : {}),
  }))
  return JSON.stringify({ items })
}

/**
 * The JSON object in a local model's reply.
 *
 * Constrained decoding sometimes emits a fragment before the object, and the
 * reply is pretty-printed, so neither "parse the whole string" nor "find a
 * literal {"items"" works. Slice from the first brace and let JSON.parse judge.
 * Exported for the local reviewer, whose replies have the same habits.
 */
export function extractJson(text: string): unknown {
  const at = text.indexOf('{')
  if (at === -1) throw new MalformedOutputError('reply contained no JSON object')
  try {
    return JSON.parse(text.slice(at))
  } catch (err) {
    throw new MalformedOutputError(`reply was not valid JSON: ${(err as Error).message}`)
  }
}

function parseResponse(content: string, units: TranslationUnit[], nplurals: number): DraftResult[] {
  const parsed = ResponseSchema.safeParse(extractJson(content))
  if (!parsed.success) throw new MalformedOutputError(`reply did not match the expected shape: ${parsed.error.message}`)

  const byId = new Map(parsed.data.items.map((i) => [i.id, i.drafts]))
  // A dropped entry would leave that string untranslated in the .po while the
  // run reported success, so it is an error rather than a gap to fill in.
  const missing = units.map((u, i) => [u, i + 1] as const).filter(([, id]) => !byId.has(id))
  if (missing.length > 0) {
    throw new MalformedOutputError(`reply left out ${missing.map(([u]) => JSON.stringify(u.key)).join(', ')}`)
  }

  return units.map((u, i) => {
    const drafts = byId.get(i + 1)!
    const wanted = u.msgidPlural === undefined ? 1 : nplurals
    return { key: u.key, drafts: drafts.slice(0, wanted) }
  })
}

export interface LocalEngineOptions {
  // Named for the model, not just the runner. The draft cache keys on this, and
  // two models behind one name would serve one model's drafts as the other's.
  name: DraftEngineName
  chat: LocalChat
  onWarning?: WarningSink
}

export function createLocalEngine(options: LocalEngineOptions): DraftEngine {
  const { name, chat } = options
  return {
    name,
    async translate(units, locale: Locale, nplurals: number): Promise<DraftResult[]> {
      if (units.length === 0) return []
      if (units.length > DEFAULT_QWEN_BATCH_ADVICE && options.onWarning) {
        options.onWarning(
          `${name}: batch of ${units.length} is above ${DEFAULT_QWEN_BATCH_ADVICE}; a local model costs more per entry as the batch grows, so a smaller --batch-size finishes sooner.`,
        )
      }

      let content: string
      try {
        content = await chat({
          system: draftSystemPrompt(locale, nplurals),
          user: userPrompt(units),
          schema: REPLY_FORMAT,
          schemaName: 'drafts',
        })
      } catch (err) {
        // Says which model, because the usual failure is that this one is not
        // pulled or the runner is not up, and "fetch failed" alone sends the
        // reader looking at the network.
        throw new Error(`${name}: ${(err as Error).message}`, { cause: err })
      }

      const drafts = parseResponse(content, units, nplurals)
      for (const result of drafts) {
        const source = units.find((u) => u.key === result.key)
        if (source) warnMissingPlaceholders(name, result.key, source.msgid, result.drafts[0] ?? '', options.onWarning)
      }
      return drafts
    },
  }
}

/** A local engine for any target, with the transport its kind needs. */
export function createLocalTargetEngine(
  target: LocalTarget,
  options: { chat?: LocalChat; fetch?: typeof fetch; onWarning?: WarningSink } = {},
): DraftEngine {
  return createLocalEngine({
    name: localModelId(target),
    chat: options.chat ?? createLocalChat(target, options.fetch ? { fetch: options.fetch } : {}),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
  })
}

/** The Ollama engine, as it was built before there was a second kind. */
export function createQwenEngine(options: QwenEngineOptions): DraftEngine {
  const client = options.client ?? ollamaTransport(options.baseUrl ?? DEFAULT_QWEN_BASE_URL)
  return createLocalEngine({
    name: localModelId({ kind: 'ollama', baseUrl: options.baseUrl ?? DEFAULT_QWEN_BASE_URL, model: options.model }),
    chat: chatFromOllama(client, options.model, options.contextLength),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
  })
}
