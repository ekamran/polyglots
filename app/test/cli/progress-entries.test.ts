import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslateEvent } from '../../src/commands/translate.js'
import type { ReviewEvent } from '../../src/types.js'
import { createProgressReporter, createReviewProgressReporter } from '../../src/cli/progress.js'

/**
 * The per-entry events exist for the TUI's list of recent entries. The CLI
 * prints one line per batch, and must print exactly the same bytes whether the
 * stream carries them or not: proved here by running each stream twice, once
 * with the entries events and once with them filtered out.
 */
const T = 1_700_000_000_000

beforeEach(() => {
  // The remaining-time estimate ends in a wall-clock time, and the ticker runs
  // on a timer: both are pinned so the two runs can be compared byte for byte.
  vi.useFakeTimers()
  vi.setSystemTime(T + 200_000)
})

afterEach(() => {
  vi.useRealTimers()
})

function capture(isTTY: boolean) {
  const chunks: string[] = []
  return { chunks, stream: { isTTY, write: (c: string) => (chunks.push(c), true) } }
}

const translateEvents: TranslateEvent[] = [
  { type: 'start', file: 'a.po', total: 300, pending: 210 },
  { type: 'tm-hit', count: 2 },
  { type: 'entries', entries: [{ key: 'A', msgid: 'A', outcome: 'memory' }, { key: 'B', msgid: 'B', outcome: 'fuzzy', from: 'memory' }] },
  { type: 'saved' },
  { type: 'batch-start', index: 1, of: 9, size: 2, at: T },
  { type: 'batch-phase', index: 1, phase: 'drafting', at: T },
  { type: 'batch-phase', index: 1, phase: 'reviewing', at: T + 10_000 },
  { type: 'entries', index: 1, entries: [{ key: 'C', msgid: 'C', outcome: 'drafted' }, { key: 'D', msgid: 'D', outcome: 'fuzzy', from: 'engine' }] },
  { type: 'batch-done', index: 1, translated: 2, fuzzy: 1, at: T + 60_000 },
  { type: 'batch-start', index: 2, of: 9, size: 1, at: T + 60_000 },
  { type: 'entries', index: 2, entries: [{ key: 'E', msgid: 'E', outcome: 'skipped' }] },
  { type: 'batch-skipped', index: 2, size: 1, reason: 'engine down', at: T + 90_000 },
  { type: 'done', summary: { file: 'a.po', total: 300, pending: 210, fromTm: 2, translated: 2, fuzzy: 1, skipped: 1 } },
]

const reviewEvents: ReviewEvent[] = [
  { type: 'start', file: 'a.po', total: 10, reviewable: 8 },
  { type: 'rules-done', flagged: 1, suspects: 2, memoryApproved: 1, memoryRepaired: 0 },
  { type: 'batch-start', index: 1, of: 3, size: 2, at: T },
  { type: 'entries', index: 1, entries: [{ key: 'A', msgid: 'A', outcome: 'approved' }, { key: 'B', msgid: 'B', outcome: 'flagged', rules: ['glossary'] }] },
  { type: 'batch-done', index: 1, problems: 1, at: T + 60_000 },
  { type: 'batch-start', index: 2, of: 3, size: 1, at: T + 60_000 },
  { type: 'entries', index: 2, entries: [{ key: 'C', msgid: 'C', outcome: 'unreviewed' }] },
  { type: 'batch-failed', index: 2, size: 1, reason: 'exit 1', at: T + 90_000 },
]

describe('the CLI reporters and per-entry events', () => {
  for (const isTTY of [true, false]) {
    it(`translate prints the same with or without them (${isTTY ? 'tty' : 'pipe'})`, () => {
      const withEntries = capture(isTTY)
      const report = createProgressReporter(withEntries.stream)
      for (const e of translateEvents) report(e)
      report.finish()

      const without = capture(isTTY)
      const plain = createProgressReporter(without.stream)
      for (const e of translateEvents.filter((e) => e.type !== 'entries')) plain(e)
      plain.finish()

      expect(withEntries.chunks.length).toBeGreaterThan(0)
      expect(withEntries.chunks).toEqual(without.chunks)
    })

    it(`review prints the same with or without them (${isTTY ? 'tty' : 'pipe'})`, () => {
      const withEntries = capture(isTTY)
      const report = createReviewProgressReporter(withEntries.stream)
      for (const e of reviewEvents) report(e)
      report.finish()

      const without = capture(isTTY)
      const plain = createReviewProgressReporter(without.stream)
      for (const e of reviewEvents.filter((e) => e.type !== 'entries')) plain(e)
      plain.finish()

      expect(withEntries.chunks.length).toBeGreaterThan(0)
      expect(withEntries.chunks).toEqual(without.chunks)
    })
  }
})
