import { describe, expect, it } from 'vitest'
import OpenAI, { APIError, RateLimitError } from 'openai'
import { createOpenAIEngine, type OpenAIClientLike, type OpenAIChatBody } from '../../src/draft/openai.js'
import { DraftQuotaError, DraftRateLimitError } from '../../src/draft/index.js'
import type { TranslationUnit } from '../../src/types.js'

type Reply = string | null | Error | { content: string | null; finish_reason: string }

function fakeClient(replies: Reply[]) {
  const calls: OpenAIChatBody[] = []
  const queue = [...replies]
  const client: OpenAIClientLike = {
    chat: {
      completions: {
        async create(body) {
          calls.push(body)
          const next = queue.shift()
          if (next === undefined) throw new Error('fake client: no reply queued')
          if (next instanceof Error) throw next
          if (next !== null && typeof next === 'object') {
            return { choices: [{ message: { content: next.content }, finish_reason: next.finish_reason }] }
          }
          return { choices: [{ message: { content: next }, finish_reason: 'stop' }] }
        },
      },
    },
  }
  return { client, calls }
}

const unit = (msgid: string, extra: Partial<TranslationUnit> = {}): TranslationUnit => ({
  key: extra.msgctxt ? `${extra.msgctxt}\u0004${msgid}` : msgid,
  msgid,
  comments: [],
  references: [],
  ...extra,
})

const json = (items: Array<{ key: string; drafts: string[] }>) => JSON.stringify({ items })

describe('createOpenAIEngine', () => {
  it('is named openai and accepts the real OpenAI client type', () => {
    const real: OpenAIClientLike = new OpenAI({ apiKey: 'sk-test' })
    const engine = createOpenAIEngine({ apiKey: 'sk-test', client: real })
    expect(engine.name).toBe('openai')
  })

  it('sends the whole batch in one JSON-mode chat completion and maps drafts by key', async () => {
    const { client, calls } = fakeClient([
      json([
        { key: 'verb\u0004Save', drafts: ['Kaydet'] },
        { key: 'Cancel', drafts: ['İptal'] },
      ]),
    ])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    const units = [unit('Cancel'), unit('Save', { msgctxt: 'verb', comments: ['translators: button label'] })]

    const results = await engine.translate(units, 'tr', 2)

    expect(calls).toHaveLength(1)
    const body = calls[0]!
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]!.role).toBe('system')
    expect(body.messages[0]!.content).toMatch(/WordPress/)
    expect(body.messages[0]!.content).toMatch(/tr/)
    expect(body.messages[0]!.content).toMatch(/"items"/)
    const userMsg = body.messages[1]!
    expect(userMsg.role).toBe('user')
    expect(JSON.parse(userMsg.content)).toEqual({
      items: [
        { key: 'Cancel', msgid: 'Cancel' },
        { key: 'verb\u0004Save', msgid: 'Save', msgctxt: 'verb', comments: ['translators: button label'] },
      ],
    })
    expect(results).toEqual([
      { key: 'Cancel', drafts: ['İptal'] },
      { key: 'verb\u0004Save', drafts: ['Kaydet'] },
    ])
  })

  it('honours a custom model', async () => {
    const { client, calls } = fakeClient([json([{ key: 'a', drafts: ['b'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client, model: 'gpt-4.1' })
    await engine.translate([unit('a')], 'tr', 2)
    expect(calls[0]!.model).toBe('gpt-4.1')
  })

  it('asks for nplurals drafts on plural units and accepts them', async () => {
    const { client, calls } = fakeClient([json([{ key: '%d item', drafts: ['%d öğe', '%d öğe'] }, { key: 'Done', drafts: ['Bitti'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })

    const results = await engine.translate([unit('%d item', { msgidPlural: '%d items' }), unit('Done')], 'tr', 2)

    expect(calls[0]!.messages[1]!.content).toContain('%d items')
    expect(calls[0]!.messages[0]!.content).toMatch(/has 2 plural form/)
    expect(calls[0]!.messages[0]!.content).toMatch(/exactly 2 drafts/)
    expect(results).toEqual([
      { key: '%d item', drafts: ['%d öğe', '%d öğe'] },
      { key: 'Done', drafts: ['Bitti'] },
    ])
  })

  it('states the nplurals value the locale actually has', async () => {
    const { client, calls } = fakeClient([json([{ key: 'One', drafts: ['a', 'b', 'c'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await engine.translate([unit('One', { msgidPlural: 'Many' })], 'ru', 3)
    expect(calls[0]!.messages[0]!.content).toMatch(/has 3 plural form/)
    expect(calls[0]!.messages[0]!.content).toMatch(/exactly 3 drafts/)
    expect(calls[0]!.messages[0]!.content).not.toMatch(/exactly 2 drafts/)
  })

  it('names the target language for any locale, not only Turkish', async () => {
    const { client, calls } = fakeClient([json([{ key: 'a', drafts: ['b'] }]), json([{ key: 'a', drafts: ['b'] }]), json([{ key: 'a', drafts: ['b'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await engine.translate([unit('a')], 'tr', 2)
    await engine.translate([unit('a')], 'de_DE', 2)
    await engine.translate([unit('a')], 'xx-invalid-tag-!!', 2)
    expect(calls[0]!.messages[0]!.content).toMatch(/into Turkish \(tr\)\./)
    expect(calls[1]!.messages[0]!.content).toMatch(/into German \(Germany\) \(de_DE\)\./)
    expect(calls[2]!.messages[0]!.content).toMatch(/into xx-invalid-tag-!!\./)
  })

  it('fails fast with an actionable error when the output was truncated by the token limit', async () => {
    const { client, calls } = fakeClient([{ content: '{"items":[{"key":"Hi","drafts":["Sel', finish_reason: 'length' }])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toThrow(/truncated.*batch/i)
    expect(calls).toHaveLength(1)
  })

  it('makes no call for an empty batch', async () => {
    const { client, calls } = fakeClient([])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    expect(await engine.translate([], 'tr', 2)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('retries once on malformed JSON, then succeeds', async () => {
    const { client, calls } = fakeClient(['not json at all', json([{ key: 'Hi', drafts: ['Selam'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })

    const results = await engine.translate([unit('Hi')], 'tr', 2)

    expect(calls).toHaveLength(2)
    expect(results).toEqual([{ key: 'Hi', drafts: ['Selam'] }])
    const retryMessages = calls[1]!.messages
    expect(retryMessages.length).toBeGreaterThan(calls[0]!.messages.length)
    expect(retryMessages[retryMessages.length - 1]!.content).toMatch(/invalid/i)
  })

  it('retries once on schema-invalid JSON, then throws', async () => {
    const { client, calls } = fakeClient([JSON.stringify({ items: [{ key: 'Hi' }] }), JSON.stringify({ nope: true })])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toThrow(/malformed|invalid/i)
    expect(calls).toHaveLength(2)
  })

  it('treats a missing key or wrong draft count as malformed', async () => {
    const { client, calls } = fakeClient([
      json([{ key: 'Other', drafts: ['x'] }]),
      json([{ key: '%d item', drafts: ['only one'] }]),
    ])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('%d item', { msgidPlural: '%d items' })], 'tr', 2)).rejects.toThrow(/malformed|invalid/i)
    expect(calls).toHaveLength(2)
  })

  it('treats empty content as malformed and never replays an empty assistant turn', async () => {
    const { client, calls } = fakeClient([null, json([{ key: 'Hi', drafts: ['Selam'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    expect(await engine.translate([unit('Hi')], 'tr', 2)).toEqual([{ key: 'Hi', drafts: ['Selam'] }])
    expect(calls).toHaveLength(2)
    const assistantTurns = calls[1]!.messages.filter((m) => m.role === 'assistant')
    expect(assistantTurns).toHaveLength(1)
    expect(assistantTurns[0]!.content.trim()).not.toBe('')
  })

  it('replays the previous non-empty output verbatim on retry', async () => {
    const { client, calls } = fakeClient(['not json at all', json([{ key: 'Hi', drafts: ['Selam'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await engine.translate([unit('Hi')], 'tr', 2)
    expect(calls[1]!.messages.find((m) => m.role === 'assistant')?.content).toBe('not json at all')
  })

  it('keeps a draft that lost a placeholder and warns without throwing', async () => {
    const warnings: string[] = []
    const { client } = fakeClient([json([{ key: 'Hello %s', drafts: ['Merhaba'] }])])
    const engine = createOpenAIEngine({ apiKey: 'k', client, onWarning: (m) => warnings.push(m) })
    const results = await engine.translate([unit('Hello %s')], 'tr', 2)
    expect(results[0]!.drafts).toEqual(['Merhaba'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('%s')
  })

  it('maps a 429 insufficient_quota error to DraftQuotaError', async () => {
    const apiErr = new RateLimitError(
      429,
      { code: 'insufficient_quota', message: 'You exceeded your current quota', type: 'insufficient_quota' },
      'You exceeded your current quota',
      new Headers(),
    )
    const { client } = fakeClient([apiErr])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    const err = await engine.translate([unit('Hi')], 'tr', 2).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DraftQuotaError)
    expect((err as DraftQuotaError).engine).toBe('openai')
  })

  it('maps a plain 429 to DraftRateLimitError', async () => {
    const apiErr = new RateLimitError(429, { code: 'rate_limit_exceeded', message: 'slow down' }, 'slow down', new Headers())
    const { client } = fakeClient([apiErr])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toBeInstanceOf(DraftRateLimitError)
  })

  it('does not retry API errors and rethrows non-429 errors untouched', async () => {
    const apiErr = new APIError(500, { message: 'server error' }, 'server error', new Headers())
    const { client, calls } = fakeClient([apiErr])
    const engine = createOpenAIEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toBe(apiErr)
    expect(calls).toHaveLength(1)
  })
})
