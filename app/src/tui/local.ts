import { batchAdvice } from '../agent/providers.js'
import { localModelId, resolveLocalTarget } from '../draft/local-chat.js'
import { engineId } from '../jobs/hash.js'
import { localBatchAdvice, localReviewBatchSize } from '../review/local.js'
import type { Locale, PolyglotsConfig, ReviewChoice } from '../types.js'

// What the review, translate and fetch screens share about the experimental
// local reviewer, so the three cannot word it or size it differently.

/** The provider as a screen names it. The local reviewer always says what it is. */
export function providerLabel(provider: ReviewChoice): string {
  return provider === 'local' ? 'local (experimental)' : provider
}

/**
 * The batch size a screen starts at: the configured one, or for the local
 * reviewer the smaller of that and its own default, as the CLI does it. An
 * agent's batch is often 100, three times what a small local context holds.
 */
export function initialBatchSize(config: PolyglotsConfig): number {
  return config.reviewProvider === 'local' ? localReviewBatchSize(config.batchSize) : config.batchSize
}

/**
 * The one warning about the chosen batch size: the agent's, or for the local
 * reviewer whether it fits the configured context. The context the server
 * reports is not asked for here, because a screen redraws on every keypress
 * and a probe per redraw is not worth a warning the CLI already gives.
 */
export function screenBatchAdvice(config: PolyglotsConfig, batchSize: number, locale: Locale): string | undefined {
  if (config.reviewProvider !== 'local') return batchAdvice(config.reviewProvider, batchSize)
  try {
    const target = resolveLocalTarget(config)
    return localBatchAdvice({
      batchSize,
      locale,
      model: engineId(localModelId(target), 'local'),
      kind: target.kind,
      ...(target.contextLength === undefined ? {} : { contextLength: target.contextLength }),
    })
  } catch (err) {
    // No model chosen for the OpenAI-compatible server: the run will refuse
    // with this same message, and the screen is the place to read it first.
    return (err as Error).message
  }
}
