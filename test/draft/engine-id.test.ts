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

// Issue #5 renamed the choice from `qwen` to `local`. The draft cache keys on
// the id, so the rename must not move it for any existing configuration: every
// cached Ollama draft has to be served again after the upgrade.
describe('draftEngineId after the local rename', () => {
  const ollama = { baseUrl: 'http://localhost:11434', model: 'qwen3.8:27b-mlx' }

  it('gives an Ollama configuration exactly the id it had as qwen', () => {
    expect(draftEngineId('local', ollama)).toBe('ollama:qwen3.8:27b-mlx')
    expect(draftEngineId('qwen', ollama)).toBe('ollama:qwen3.8:27b-mlx')
    expect(draftEngineId('local', { kind: 'ollama', ...ollama })).toBe('ollama:qwen3.8:27b-mlx')
    expect(getDraftEngine('local', {}, { ollama }).name).toBe('ollama:qwen3.8:27b-mlx')
  })

  it('names an OpenAI-compatible server and its model, in a namespace nothing else uses', () => {
    const lmStudio = { kind: 'openai-compatible' as const, baseUrl: 'http://localhost:1234/v1/', model: 'qwen/qwen3-8b' }
    expect(draftEngineId('local', lmStudio)).toBe('openai-compatible:localhost:1234/qwen/qwen3-8b')
    expect(getDraftEngine('local', {}, { local: lmStudio }).name).toBe('openai-compatible:localhost:1234/qwen/qwen3-8b')
  })

  it('keeps two servers serving the same name apart', () => {
    const model = 'qwen2.5-7b-instruct'
    const a = draftEngineId('local', { kind: 'openai-compatible', baseUrl: 'http://localhost:1234', model })
    const b = draftEngineId('local', { kind: 'openai-compatible', baseUrl: 'http://localhost:8080', model })
    expect(a).not.toBe(b)
  })
})
