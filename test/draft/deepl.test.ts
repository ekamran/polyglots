import { describe, expect, it } from 'vitest'
import { DeepLClient, QuotaExceededError, TooManyRequestsError } from 'deepl-node'
import { createDeepLEngine, toDeepLTarget, type DeepLClientLike } from '../../src/draft/deepl.js'
import { DraftQuotaError, DraftRateLimitError } from '../../src/draft/index.js'
import type { TranslationUnit } from '../../src/types.js'

type Call = { texts: string[]; sourceLang: string | null; targetLang: string; options?: Record<string, unknown> }

function fakeClient(reply: (texts: string[]) => string[] | Error) {
  const calls: Call[] = []
  const client: DeepLClientLike = {
    async translateText(texts, sourceLang, targetLang, options) {
      calls.push({ texts: [...texts], sourceLang, targetLang, options: options as Record<string, unknown> })
      const out = reply([...texts])
      if (out instanceof Error) throw out
      return out.map((text) => ({ text }))
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

describe('createDeepLEngine', () => {
  it('is named deepl and accepts the real DeepLClient type', () => {
    const real: DeepLClientLike = new DeepLClient('0000:fx')
    const engine = createDeepLEngine({ apiKey: '0000:fx', client: real })
    expect(engine.name).toBe('deepl')
  })

  it('sends a batch of up to 50 texts in one translateText call with en → locale', async () => {
    const { client, calls } = fakeClient((texts) => texts.map((t) => `TR(${t})`))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    const units = [unit('Save'), unit('Cancel'), unit('Save', { msgctxt: 'verb' })]

    const results = await engine.translate(units, 'tr', 2)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.texts).toEqual(['Save', 'Cancel', 'Save'])
    expect(calls[0]!.sourceLang).toBe('en')
    expect(calls[0]!.targetLang).toBe('tr')
    expect(calls[0]!.options?.tagHandling).toBeUndefined()
    expect(results).toEqual([
      { key: 'Save', drafts: ['TR(Save)'] },
      { key: 'Cancel', drafts: ['TR(Cancel)'] },
      { key: 'verb\u0004Save', drafts: ['TR(Save)'] },
    ])
  })

  it('expands plurals: index 0 from msgid, the rest from msgidPlural, still one call', async () => {
    const { client, calls } = fakeClient((texts) => texts.map((t) => `TR(${t})`))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    const units = [unit('%d item', { msgidPlural: '%d items' }), unit('Done')]

    const results = await engine.translate(units, 'tr', 2)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.texts).toEqual(['%d item', '%d items', 'Done'])
    expect(results).toEqual([
      { key: '%d item', drafts: ['TR(%d item)', 'TR(%d items)'] },
      { key: 'Done', drafts: ['TR(Done)'] },
    ])
  })

  it('produces nplurals drafts for locales with more than two forms', async () => {
    const { client } = fakeClient((texts) => texts.map((t) => `X(${t})`))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    const [result] = await engine.translate([unit('One', { msgidPlural: 'Many' })], 'ru', 3)
    expect(result!.drafts).toEqual(['X(One)', 'X(Many)', 'X(Many)'])
  })

  it('makes no call for an empty batch', async () => {
    const { client, calls } = fakeClient(() => [])
    const engine = createDeepLEngine({ apiKey: 'k', client })
    expect(await engine.translate([], 'tr', 2)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('keeps a draft that lost a placeholder and reports it via onWarning without throwing', async () => {
    const warnings: string[] = []
    const { client } = fakeClient(() => ['Merhaba dünya'])
    const engine = createDeepLEngine({ apiKey: 'k', client, onWarning: (m) => warnings.push(m) })

    const results = await engine.translate([unit('Hello %1$s, {name}')], 'tr', 2)

    expect(results[0]!.drafts).toEqual(['Merhaba dünya'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('%1$s')
    expect(warnings[0]).toContain('{name}')
  })

  it('does not warn when every placeholder survives', async () => {
    const warnings: string[] = []
    const { client } = fakeClient(() => ['{name} için %s'])
    const engine = createDeepLEngine({ apiKey: 'k', client, onWarning: (m) => warnings.push(m) })
    await engine.translate([unit('%s for {name}')], 'tr', 2)
    expect(warnings).toEqual([])
  })

  it('maps QuotaExceededError to DraftQuotaError', async () => {
    const { client } = fakeClient(() => new QuotaExceededError('Quota for this billing period has been exceeded'))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    const err = await engine.translate([unit('Hi')], 'tr', 2).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DraftQuotaError)
    expect((err as DraftQuotaError).engine).toBe('deepl')
    expect((err as Error).message).toMatch(/quota/i)
  })

  it('maps TooManyRequestsError to DraftRateLimitError', async () => {
    const { client } = fakeClient(() => new TooManyRequestsError('Too many requests'))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toBeInstanceOf(DraftRateLimitError)
  })

  it('rethrows unrelated errors untouched', async () => {
    const boom = new Error('network down')
    const { client } = fakeClient(() => boom)
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('Hi')], 'tr', 2)).rejects.toBe(boom)
  })

  it('throws when the API returns a different number of texts', async () => {
    const { client } = fakeClient(() => ['only one'])
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await expect(engine.translate([unit('a'), unit('b')], 'tr', 2)).rejects.toThrow(/expected 2/i)
  })

  it('maps bare target locales DeepL refuses to their regional codes', async () => {
    const { client, calls } = fakeClient((texts) => texts)
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await engine.translate([unit('a')], 'en', 2)
    await engine.translate([unit('a')], 'pt', 2)
    expect(calls.map((c) => c.targetLang)).toEqual(['en-US', 'pt-PT'])
  })

  it('strips the region from WordPress-style locales DeepL has no regional target for', async () => {
    const { client, calls } = fakeClient((texts) => texts)
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await engine.translate([unit('a')], 'tr_TR', 2)
    await engine.translate([unit('a')], 'de_DE', 2)
    await engine.translate([unit('a')], 'nb_NO', 2)
    expect(calls.map((c) => c.targetLang)).toEqual(['tr', 'de', 'nb'])
  })

  it('splits more than 50 texts into several requests and stitches the results back in order', async () => {
    const { client, calls } = fakeClient((texts) => texts.map((t) => `TR(${t})`))
    const engine = createDeepLEngine({ apiKey: 'k', client })
    const units = Array.from({ length: 30 }, (_, i) => unit(`%d item ${i}`, { msgidPlural: `%d items ${i}` }))

    const results = await engine.translate(units, 'tr', 2)

    expect(calls.map((c) => c.texts.length)).toEqual([50, 10])
    expect(calls.every((c) => c.targetLang === 'tr' && c.sourceLang === 'en')).toBe(true)
    expect(results).toHaveLength(30)
    expect(results[0]).toEqual({ key: '%d item 0', drafts: ['TR(%d item 0)', 'TR(%d items 0)'] })
    expect(results[24]).toEqual({ key: '%d item 24', drafts: ['TR(%d item 24)', 'TR(%d items 24)'] })
    expect(results[29]).toEqual({ key: '%d item 29', drafts: ['TR(%d item 29)', 'TR(%d items 29)'] })
  })

  it('sends exactly 50 texts in a single request', async () => {
    const { client, calls } = fakeClient((texts) => texts)
    const engine = createDeepLEngine({ apiKey: 'k', client })
    await engine.translate(Array.from({ length: 50 }, (_, i) => unit(`s${i}`)), 'tr', 2)
    expect(calls.map((c) => c.texts.length)).toEqual([50])
  })
})

describe('toDeepLTarget', () => {
  it.each([
    ['tr', 'tr'],
    ['tr_TR', 'tr'],
    ['de_DE', 'de'],
    ['nb_NO', 'nb'],
    ['fr-FR', 'fr'],
    ['en', 'en-US'],
    ['en_US', 'en-US'],
    ['en_GB', 'en-GB'],
    ['en_AU', 'en-GB'],
    ['pt', 'pt-PT'],
    ['pt_PT', 'pt-PT'],
    ['pt_BR', 'pt-BR'],
    ['zh', 'zh-HANS'],
    ['zh_CN', 'zh-HANS'],
    ['zh_TW', 'zh-HANT'],
    ['zh_HK', 'zh-HANT'],
    ['es', 'es'],
    ['es_ES', 'es'],
    ['es_MX', 'es-419'],
    ['es_419', 'es-419'],
  ])('%s -> %s', (input, expected) => {
    expect(toDeepLTarget(input)).toBe(expected)
  })
})
