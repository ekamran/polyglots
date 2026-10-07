import { describe, expect, it } from 'vitest'
import { agentBinOverride, ANTIGRAVITY_MIN_BATCH, batchAdvice } from '../../src/agent/providers.js'

describe('batchAdvice', () => {
  // The instinct after a timeout is to shrink the batch. On this agent that
  // makes it worse, so the advice has to be where the size is chosen.
  it('warns when a batch is too small for antigravity', () => {
    expect(batchAdvice('antigravity', 10)).toMatch(/round trips per entry/)
    expect(batchAdvice('antigravity', ANTIGRAVITY_MIN_BATCH - 1)).toBeDefined()
  })

  it('says nothing once the batch is big enough', () => {
    expect(batchAdvice('antigravity', ANTIGRAVITY_MIN_BATCH)).toBeUndefined()
    expect(batchAdvice('antigravity', 50)).toBeUndefined()
  })

  // Claude issues its tool calls concurrently, so a small batch costs it
  // nothing extra and the warning would be noise.
  it('says nothing for claude, whatever the size', () => {
    expect(batchAdvice('claude', 5)).toBeUndefined()
    expect(batchAdvice(undefined, 5)).toBeUndefined()
  })
})

describe('the local reviewer', () => {
  // A local model's batch advice is about its context window, not about tool
  // round trips, and lives with the local reviewer (localBatchAdvice).
  it('gets no agent batch advice', () => {
    expect(batchAdvice('local', 5)).toBeUndefined()
  })

  it('has no binary to override, whatever the environment says', () => {
    expect(agentBinOverride('local', { POLYGLOTS_AGENT_BIN: '/x/agent' })).toBeUndefined()
  })
})
