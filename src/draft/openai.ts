import OpenAI, { APIError } from 'openai'
import { z } from 'zod'
import type { DraftEngine, DraftResult, Locale, TranslationUnit } from '../types.js'
import { DraftQuotaError, DraftRateLimitError } from './errors.js'
import { warnMissingPlaceholders, type WarningSink } from './placeholders.js'

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIChatBody {
  model: string
  messages: OpenAIChatMessage[]
  response_format: { type: 'json_object' }
}

export interface OpenAIChatResponse {
  choices: ReadonlyArray<{ message: { content: string | null }; finish_reason?: string | null }>
}

export interface OpenAIClientLike {
  chat: { completions: { create(body: OpenAIChatBody): Promise<OpenAIChatResponse> } }
}

export interface OpenAIEngineOptions {
  apiKey: string
  model?: string
  client?: OpenAIClientLike
  onWarning?: WarningSink
}

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

const ResponseSchema = z.object({
  items: z.array(z.object({ key: z.string(), drafts: z.array(z.string()).min(1) })),
})

class MalformedOutputError extends Error {
  override readonly name = 'MalformedOutputError'
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

export function describeLocale(locale: Locale): string {
  const tag = locale.replaceAll('_', '-')
  let name: string | undefined
  try {
    name = languageNames.of(tag)
  } catch {
    name = undefined
  }
  return name && name !== tag ? `${name} (${locale})` : locale
}

function systemPrompt(locale: Locale, nplurals: number): string {
  return [
    `You are a professional WordPress UI translator. Translate each item from English (en) into ${describeLocale(locale)}.`,
    'These are gettext strings from WordPress core, plugins and themes: UI labels, messages, settings.',
    'Rules:',
    '- Keep every placeholder exactly as written (%s, %d, %1$s, %2$d, %.2f, {name}, ###TOKEN###) and in a natural position.',
    '- Keep HTML tags, attributes, entities, Markdown, whitespace, leading/trailing spaces and newlines intact.',
    '- Do not translate code, URLs, shortcodes, or option/CSS/PHP identifiers.',
    '- Use the msgctxt and comments as disambiguation hints; produce natural, concise UI wording.',
    `- The target locale has ${nplurals} plural form(s). For an item WITHOUT "msgidPlural", return exactly 1 draft. For an item WITH "msgidPlural", return exactly ${nplurals} drafts: index 0 translates "msgid" (singular), the remaining indexes translate "msgidPlural" for the locale's other plural forms, in order.`,
    '- Return every input item, using its "key" unchanged.',
    'Return ONLY a JSON object of the shape {"items":[{"key":"...","drafts":["..."]}]} with no prose.',
  ].join('\n')
}

function userPrompt(units: TranslationUnit[]): string {
  const items = units.map((u) => ({
    key: u.key,
    msgid: u.msgid,
    ...(u.msgctxt !== undefined ? { msgctxt: u.msgctxt } : {}),
    ...(u.msgidPlural !== undefined ? { msgidPlural: u.msgidPlural } : {}),
    ...(u.comments.length > 0 ? { comments: u.comments } : {}),
  }))
  return JSON.stringify({ items }, null, 2)
}

function parseResponse(content: string | null, units: TranslationUnit[], nplurals: number): DraftResult[] {
  if (!content || content.trim() === '') throw new MalformedOutputError('empty completion content')

  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (err) {
    throw new MalformedOutputError(`invalid JSON: ${(err as Error).message}`)
  }

  const parsed = ResponseSchema.safeParse(raw)
  if (!parsed.success) throw new MalformedOutputError(`invalid shape: ${parsed.error.message}`)

  const byKey = new Map(parsed.data.items.map((item) => [item.key, item.drafts]))
  return units.map((u) => {
    const drafts = byKey.get(u.key)
    if (!drafts) throw new MalformedOutputError(`missing item for key ${JSON.stringify(u.key)}`)
    const expected = u.msgidPlural === undefined ? 1 : nplurals
    if (drafts.length !== expected) {
      throw new MalformedOutputError(`expected ${expected} draft(s) for key ${JSON.stringify(u.key)}, got ${drafts.length}`)
    }
    return { key: u.key, drafts }
  })
}

function mapOpenAIError(err: unknown): unknown {
  if (!(err instanceof APIError) || err.status !== 429) return err
  if (err.code === 'insufficient_quota') return new DraftQuotaError('openai', err.message, err)
  return new DraftRateLimitError('openai', err.message, err)
}

export function createOpenAIEngine(opts: OpenAIEngineOptions): DraftEngine {
  const client: OpenAIClientLike = opts.client ?? new OpenAI({ apiKey: opts.apiKey })
  const model = opts.model ?? DEFAULT_OPENAI_MODEL

  return {
    name: 'openai',
    async translate(units: TranslationUnit[], locale: Locale, nplurals: number): Promise<DraftResult[]> {
      if (units.length === 0) return []

      const messages: OpenAIChatMessage[] = [
        { role: 'system', content: systemPrompt(locale, nplurals) },
        { role: 'user', content: userPrompt(units) },
      ]

      let results: DraftResult[] | undefined
      for (let attempt = 0; attempt < 2 && !results; attempt++) {
        let content: string | null
        try {
          const response = await client.chat.completions.create({
            model,
            messages: [...messages],
            response_format: { type: 'json_object' },
          })
          const choice = response.choices[0]
          if (choice?.finish_reason === 'length') {
            throw new Error(`openai: output truncated by the model's token limit for ${units.length} units; use a smaller batch`)
          }
          content = choice?.message.content ?? null
        } catch (err) {
          throw mapOpenAIError(err)
        }

        try {
          results = parseResponse(content, units, nplurals)
        } catch (err) {
          if (!(err instanceof MalformedOutputError)) throw err
          if (attempt === 1) throw new Error(`openai: malformed output after retry (${err.message})`, { cause: err })
          messages.push(
            { role: 'assistant', content: content && content.trim() !== '' ? content : '(empty response)' },
            { role: 'user', content: `Your previous output was invalid (${err.message}). Return ONLY the JSON object described in the instructions.` },
          )
        }
      }

      for (const [i, r] of results!.entries()) {
        const u = units[i]!
        warnMissingPlaceholders('openai', u.key, u.msgid, r.drafts[0]!, opts.onWarning)
        if (u.msgidPlural !== undefined) {
          for (const d of r.drafts.slice(1)) warnMissingPlaceholders('openai', u.key, u.msgidPlural, d, opts.onWarning)
        }
      }
      return results!
    },
  }
}
