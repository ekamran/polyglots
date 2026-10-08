import { describe, expect, it } from 'vitest'
import { defaultQwenModel } from '../../src/draft/qwen.js'

// Ollama runs MLX builds on Apple silicon only, so the default local model is
// the MLX build there and the plain build everywhere else, where the MLX one
// would fail until the person chose another.
describe('defaultQwenModel', () => {
  it('is the MLX build on Apple silicon', () => {
    expect(defaultQwenModel('darwin', 'arm64')).toBe('qwen3.8:27b-mlx')
  })

  it.each([
    ['linux', 'x64'],
    ['linux', 'arm64'],
    ['win32', 'x64'],
    ['darwin', 'x64'],
  ] as const)('is the plain build on %s %s', (platform, arch) => {
    expect(defaultQwenModel(platform, arch)).toBe('qwen3.8:27b')
  })
})
