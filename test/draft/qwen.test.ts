import { describe, expect, it } from 'vitest'
import { createQwenEngine, DEFAULT_QWEN_BATCH_ADVICE, type QwenClientLike, type QwenChatBody } from '../../src/draft/qwen.js'
import type { TranslationUnit } from '../../src/types.js'

// The engine talks to Ollama over a streamed HTTP body. The fake stands in for
// that transport and hands back whole responses, so these tests are about what
// the engine does with them rather than about the socket.
function fakeClient(replies: Array<string | Error>) {
  const calls: QwenChatBody[] = []
  const queue = [...replies]
  const client: QwenClientLike = {
    async chat(body) {
      calls.push(body)
      const next = queue.shift()
      if (next === undefined) throw new Error('fake client: no reply queued')
      if (next instanceof Error) throw next
      return next
    },
  }
  return { client, calls }
}

const unit = (over: Partial<TranslationUnit> = {}): TranslationUnit => ({
  key: 'Save Changes',
  msgid: 'Save Changes',
  comments: [],
  references: [],
  ...over,
})

// Items come back by 1-based id, never by key: a gettext key can start with a
// newline and end in spaces, and a model asked to echo one quietly normalises it.
const reply = (items: Array<{ id: number; drafts: string[] }>) => JSON.stringify({ items })

describe('createQwenEngine', () => {
  it('names itself after the model, not just the runner', async () => {
    // The draft cache keys on the engine name. Two models behind one name would
    // serve one model's drafts as the other's, which is the defect the review
    // side had with --model.
    const { client } = fakeClient([])
    const engine = createQwenEngine({ client, model: 'qwen3.8:27b-mlx' })
    expect(engine.name).toBe('ollama:qwen3.8:27b-mlx')
  })

  it('returns a draft per unit, keyed as it was asked', async () => {
    const { client } = fakeClient([reply([{ id: 1, drafts: ['Değişiklikleri kaydet'] }])])
    const engine = createQwenEngine({ client, model: 'm' })
    const out = await engine.translate([unit()], 'tr', 2)
    // Ids are the wire format; the result is keyed, because that is what the
    // .po needs to apply it.
    expect(out).toEqual([{ key: 'Save Changes', drafts: ['Değişiklikleri kaydet'] }])
  })

  it('asks for every plural form when the entry has one', async () => {
    const { client, calls } = fakeClient([
      reply([{ id: 1, drafts: ['%d öğe', '%d öğe'] }]),
    ])
    const engine = createQwenEngine({ client, model: 'm' })
    const out = await engine.translate([unit({ key: '%d item', msgid: '%d item', msgidPlural: '%d items' })], 'tr', 2)
    expect(out[0]!.drafts).toHaveLength(2)
    expect(calls[0]!.messages[0]!.content).toContain('2 plural form')
  })

  it('streams, because a non-streamed body times out before it answers', () => {
    // Node's fetch gives up waiting for response headers after 300s and Ollama
    // sends nothing until generation finishes. A batch of any real size dies.
    const { client, calls } = fakeClient([reply([{ id: 1, drafts: ['x'] }])])
    const engine = createQwenEngine({ client, model: 'm' })
    return engine.translate([unit()], 'tr', 2).then(() => {
      expect(calls[0]!.stream).toBe(true)
    })
  })

  it('constrains the reply with a schema rather than hoping for JSON', async () => {
    const { client, calls } = fakeClient([reply([{ id: 1, drafts: ['x'] }])])
    await createQwenEngine({ client, model: 'm' }).translate([unit()], 'tr', 2)
    expect(calls[0]!.format).toMatchObject({ type: 'object' })
  })

  it('reads a reply that arrives pretty-printed', async () => {
    // Ollama pretty-prints, so an extractor matching a literal `{"items"` finds
    // nothing. This cost a probe run to learn.
    const pretty = '{\n  "items": [\n    {\n      "id": 1,\n      "drafts": ["Kaydet"]\n    }\n  ]\n}'
    const { client } = fakeClient([pretty])
    const out = await createQwenEngine({ client, model: 'm' }).translate([unit()], 'tr', 2)
    expect(out[0]!.drafts).toEqual(['Kaydet'])
  })

  it('reads a reply that arrives with a stray prefix', async () => {
    // Constrained decoding sometimes emits a fragment before the object.
    const { client } = fakeClient([`id":1${reply([{ id: 1, drafts: ['Kaydet'] }])}`])
    const out = await createQwenEngine({ client, model: 'm' }).translate([unit()], 'tr', 2)
    expect(out[0]!.drafts).toEqual(['Kaydet'])
  })

  it('refuses a reply that is not JSON at all, rather than inventing a draft', async () => {
    const { client } = fakeClient(['the model apologises and explains itself'])
    await expect(createQwenEngine({ client, model: 'm' }).translate([unit()], 'tr', 2)).rejects.toThrow()
  })

  it('refuses a reply missing a unit it was asked about', async () => {
    // A silently dropped entry would leave the .po untouched for that string
    // while the run reported success.
    // Only id 1 comes back; the unit at id 2 is missing and must be named.
    const { client } = fakeClient([reply([{ id: 1, drafts: ['Kaydet'] }])])
    const engine = createQwenEngine({ client, model: 'm' })
    await expect(engine.translate([unit(), unit({ key: 'Cancel', msgid: 'Cancel' })], 'tr', 2)).rejects.toThrow(
      /Cancel/,
    )
  })

  it('warns when a draft dropped a placeholder', async () => {
    const warnings: string[] = []
    const { client } = fakeClient([reply([{ id: 1, drafts: ['Merhaba'] }])])
    const engine = createQwenEngine({ client, model: 'm', onWarning: (m) => warnings.push(m) })
    await engine.translate([unit({ key: 'Hello %s', msgid: 'Hello %s' })], 'tr', 2)
    expect(warnings.join(' ')).toContain('%s')
  })

  it('warns when the batch is large enough to cost more per entry', async () => {
    // Measured: 15 entries run at 1.4s each, 60 at 4.6s. A user who raised the
    // batch size for the metered engines would silently triple a local run.
    const warnings: string[] = []
    const units = Array.from({ length: DEFAULT_QWEN_BATCH_ADVICE + 1 }, (_, i) =>
      unit({ key: `k${i}`, msgid: `k${i}` }),
    )
    const { client } = fakeClient([reply(units.map((_u, i) => ({ id: i + 1, drafts: ['x'] })))])
    await createQwenEngine({ client, model: 'm', onWarning: (m) => warnings.push(m) }).translate(units, 'tr', 2)
    expect(warnings.join(' ')).toMatch(/batch/i)
  })

  it('says which model failed when the runner is unreachable', async () => {
    const { client } = fakeClient([new Error('fetch failed')])
    const engine = createQwenEngine({ client, model: 'qwen3.8:27b-mlx' })
    await expect(engine.translate([unit()], 'tr', 2)).rejects.toThrow(/qwen3\.8:27b-mlx/)
  })
})
