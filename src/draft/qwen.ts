import { z } from 'zod'
import type { DraftEngine, DraftEngineName, DraftResult, Locale, TranslationUnit } from '../types.js'
import { draftSystemPrompt } from './prompt.js'
import { warnMissingPlaceholders, type WarningSink } from './placeholders.js'

// A draft engine that runs against a local Ollama, so a long translate costs
// nothing and has no quota. It is shaped like the OpenAI engine — same prompt,
// same {items} reply, same placeholder warnings — and differs in two ways that
// are both consequences of the model running on this machine.

export interface QwenChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface QwenChatBody {
  model: string
  // Always true. Node's fetch abandons a request after 300s without response
  // headers, and Ollama sends none until the whole generation is finished, so
  // a non-streamed call dies on any batch worth sending. Streaming makes the
  // headers arrive immediately; the deltas themselves are incidental.
  stream: true
  think: false
  format: unknown
  messages: QwenChatMessage[]
}

/** Returns the assistant's full message content, accumulated from the stream. */
export interface QwenClientLike {
  chat(body: QwenChatBody): Promise<string>
}

export interface QwenEngineOptions {
  model: string
  baseUrl?: string
  client?: QwenClientLike
  onWarning?: WarningSink
}

export const DEFAULT_QWEN_BASE_URL = 'http://localhost:11434'
export const DEFAULT_QWEN_MODEL = 'qwen3.8:27b-mlx'

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

// Constrained decoding sometimes emits a fragment before the object, and the
// reply is pretty-printed, so neither "parse the whole string" nor "find a
// literal {"items"" works. Slice from the first brace and let JSON.parse judge.
function extractJson(text: string): unknown {
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

// The default transport. Kept apart from the engine so a test can stand in for
// the socket without standing in for the parsing.
function httpClient(baseUrl: string): QwenClientLike {
  return {
    async chat(body) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      if (!res.body) throw new Error('response had no body')

      let text = ''
      let buffered = ''
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffered += Buffer.from(chunk).toString('utf8')
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === '') continue
          try {
            text += (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? ''
          } catch {
            // A partial line is normal mid-stream; the next chunk completes it.
          }
        }
      }
      return text
    },
  }
}

export function createQwenEngine(options: QwenEngineOptions): DraftEngine {
  const client = options.client ?? httpClient(options.baseUrl ?? DEFAULT_QWEN_BASE_URL)
  // Named for the model, not just the runner. The draft cache keys on this, and
  // two models behind one name would serve one model's drafts as the other's.
  const name: DraftEngineName = `ollama:${options.model}`

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
        content = await client.chat({
          model: options.model,
          stream: true,
          think: false,
          format: REPLY_FORMAT,
          messages: [
            { role: 'system', content: draftSystemPrompt(locale, nplurals) },
            { role: 'user', content: userPrompt(units) },
          ],
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
