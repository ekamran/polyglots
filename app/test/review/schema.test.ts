import { describe, expect, it } from 'vitest'
import { reviewBatchJsonSchema, reviewBatchSchema } from '../../src/review/schema.js'

describe('reviewBatchJsonSchema', () => {
  it('identifies results by a 1-based integer id, never by the gettext key', () => {
    const item = reviewBatchJsonSchema.properties.results.items
    expect([...item.required].sort()).toEqual(['fuzzy', 'id', 'reason', 'text'])
    expect(item.properties.id).toEqual({ type: 'integer', minimum: 1 })
    expect(item.properties).not.toHaveProperty('key')
  })

  it('requires at least one non-empty text form', () => {
    const text = reviewBatchJsonSchema.properties.results.items.properties.text
    expect(text.minItems).toBe(1)
    expect(text.items.minLength).toBe(1)
  })

  it('is plain JSON-serializable', () => {
    expect(JSON.parse(JSON.stringify(reviewBatchJsonSchema))).toEqual(reviewBatchJsonSchema)
  })
})

describe('reviewBatchSchema (zod)', () => {
  const valid = { results: [{ id: 1, text: ['b'], fuzzy: false, reason: 'ok' }] }

  it('accepts a valid batch', () => {
    expect(reviewBatchSchema.parse(valid).results[0]!.text).toEqual(['b'])
  })

  it('rejects an empty string as a text form', () => {
    expect(() => reviewBatchSchema.parse({ results: [{ id: 1, text: [''], fuzzy: false, reason: 'x' }] })).toThrow()
    expect(() =>
      reviewBatchSchema.parse({ results: [{ id: 1, text: ['a', ''], fuzzy: false, reason: 'x' }] }),
    ).toThrow()
  })

  it('rejects an empty text array', () => {
    expect(() => reviewBatchSchema.parse({ results: [{ id: 1, text: [], fuzzy: false, reason: 'x' }] })).toThrow()
  })

  it('rejects non-positive or non-integer ids', () => {
    expect(() => reviewBatchSchema.parse({ results: [{ id: 0, text: ['b'], fuzzy: false, reason: 'x' }] })).toThrow()
    expect(() =>
      reviewBatchSchema.parse({ results: [{ id: 1.5, text: ['b'], fuzzy: false, reason: 'x' }] }),
    ).toThrow()
    expect(() =>
      reviewBatchSchema.parse({ results: [{ id: '1', text: ['b'], fuzzy: false, reason: 'x' }] }),
    ).toThrow()
  })

  it('rejects a result missing a required field', () => {
    expect(() => reviewBatchSchema.parse({ results: [{ id: 1, text: ['b'], fuzzy: false }] })).toThrow()
  })

  it('rejects wrong types', () => {
    expect(() =>
      reviewBatchSchema.parse({ results: [{ id: 1, text: 'b', fuzzy: 'no', reason: 'x' }] }),
    ).toThrow()
  })

  it('rejects a payload without results', () => {
    expect(() => reviewBatchSchema.parse({})).toThrow()
  })
})
