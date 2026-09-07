import { describe, expect, it } from 'vitest'
import { chunk } from '../../src/batch.js'

describe('chunk', () => {
  it('splits into equal chunks with a smaller tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns a single chunk when size exceeds length', () => {
    expect(chunk(['a', 'b'], 10)).toEqual([['a', 'b']])
  })

  it('returns an empty array for empty input', () => {
    expect(chunk([], 3)).toEqual([])
  })

  it('preserves order and does not mutate the input', () => {
    const input = [3, 1, 2]
    const result = chunk(input, 2)
    expect(result.flat()).toEqual([3, 1, 2])
    expect(input).toEqual([3, 1, 2])
  })

  it('rejects non-positive or fractional sizes', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
    expect(() => chunk([1], -1)).toThrow(RangeError)
    expect(() => chunk([1], 1.5)).toThrow(RangeError)
  })
})
