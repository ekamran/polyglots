export type { DraftEngineName } from '../types.js'
import type { DraftEngineName } from '../types.js'

export class DraftQuotaError extends Error {
  override readonly name = 'DraftQuotaError'
  constructor(
    readonly engine: DraftEngineName,
    message: string,
    cause?: unknown,
  ) {
    super(`${engine}: ${message}`, { cause })
  }
}

export class DraftRateLimitError extends Error {
  override readonly name = 'DraftRateLimitError'
  constructor(
    readonly engine: DraftEngineName,
    message: string,
    cause?: unknown,
  ) {
    super(`${engine}: ${message}`, { cause })
  }
}
