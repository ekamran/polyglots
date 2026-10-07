import { describe, expect, it } from 'vitest'
import * as storage from '../../src/storage/index.js'

describe('storage index', () => {
  it('re-exports the public API', () => {
    for (const name of [
      'openDb',
      'upsertTm',
      'findExactTm',
      'searchTm',
      'replaceGlossary',
      'lookupGlossary',
      'getConsistency',
      'setConsistency',
    ]) {
      expect(typeof (storage as Record<string, unknown>)[name]).toBe('function')
    }
  })
})
