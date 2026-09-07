import type { DraftEngine } from '../types.js'

export type DraftEngineName = DraftEngine['name']

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
