import { describe, expect, it } from 'vitest'
import { draftEngineId, getDraftEngine, DEFAULT_QWEN_MODEL } from '../../src/draft/index.js'

describe('draftEngineId', () => {
  // The cache key and the run row are written before the engine is built, so
  // the name has to be derivable without building one. When these two disagree
  // the cache is keyed by something no engine answers to.
  it('agrees with what the engine built from the same inputs calls itself', () => {
    const ollama = { baseUrl: 'http://localhost:11434', model: 'qwen3.8:27b-mlx' }
    expect(draftEngineId('qwen', ollama)).toBe(getDraftEngine('qwen', {}, { ollama }).name)
  })

  it('names the local model, so two models never share a key', () => {
    expect(draftEngineId('qwen', { model: 'qwen3.8:27b-mlx' })).toBe('ollama:qwen3.8:27b-mlx')
    expect(draftEngineId('qwen', { model: 'llama3.3:70b' })).toBe('ollama:llama3.3:70b')
  })

  it('falls back to the model the factory would have defaulted to', () => {
    expect(draftEngineId('qwen')).toBe(`ollama:${DEFAULT_QWEN_MODEL}`)
    expect(draftEngineId('qwen', {})).toBe(`ollama:${DEFAULT_QWEN_MODEL}`)
  })

  // The metered engines call themselves exactly what they are chosen by, so
  // nothing about them changes.
  it('leaves the metered engines as their own name', () => {
    expect(draftEngineId('deepl')).toBe('deepl')
    expect(draftEngineId('openai')).toBe('openai')
  })
})
