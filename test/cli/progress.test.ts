import { describe, expect, it } from 'vitest'
import type { TranslateEvent } from '../../src/commands/translate.js'
import { applyEvent, createProgressReporter, formatProgress, initialProgress, noticeFor, createReviewProgressReporter, estimateRemainingMs, formatDuration } from '../../src/cli/progress.js'

const events: TranslateEvent[] = [
  { type: 'start', file: 'a.po', total: 300, pending: 210 },
  { type: 'tm-hit', count: 12 },
  { type: 'saved' },
  { type: 'batch-start', index: 1, of: 9, size: 25 },
  { type: 'batch-done', index: 1, translated: 25, fuzzy: 3 },
  { type: 'saved' },
  { type: 'batch-start', index: 2, of: 9, size: 25 },
  { type: 'warning', message: 'placeholder %s missing in "Hello %s"' },
  { type: 'batch-skipped', index: 2, size: 25, reason: 'claude exited 1' },
  { type: 'batch-start', index: 3, of: 9, size: 25 },
  { type: 'batch-done', index: 3, translated: 5, fuzzy: 1 },
  { type: 'done', summary: { file: 'a.po', total: 300, pending: 210, fromTm: 12, translated: 30, fuzzy: 4, skipped: 25 } },
]

function run(upTo: number) {
  return events.slice(0, upTo).reduce(applyEvent, initialProgress)
}

describe('formatProgress', () => {
  it('renders an empty bar before any work', () => {
    expect(formatProgress(run(1))).toBe('[----------] 0/210')
  })

  it('counts TM hits as processed', () => {
    expect(formatProgress(run(2))).toBe('[#---------] 12/210')
  })

  it('shows the current batch and fuzzy count once batching starts', () => {
    expect(formatProgress(run(4))).toBe('[#---------] 12/210  batch 1/9  fuzzy 0')
    expect(formatProgress(run(5))).toBe('[##--------] 37/210  batch 1/9  fuzzy 3')
  })

  it('counts skipped batches as processed', () => {
    expect(formatProgress(run(9))).toBe('[###-------] 62/210  batch 2/9  fuzzy 3')
    expect(formatProgress(run(11))).toBe('[###-------] 67/210  batch 3/9  fuzzy 4')
  })

  it('renders a full bar when nothing is pending', () => {
    const state = applyEvent(initialProgress, { type: 'start', file: 'x.po', total: 5, pending: 0 })
    expect(formatProgress(state)).toBe('[##########] 0/0')
  })

  it('never rounds a partial run up to a full bar', () => {
    let state = applyEvent(initialProgress, { type: 'start', file: 'x.po', total: 100, pending: 100 })
    state = applyEvent(state, { type: 'tm-hit', count: 99 })
    expect(formatProgress(state)).toBe('[#########-] 99/100')
  })
})

describe('noticeFor', () => {
  it('turns warnings and skipped batches into persistent lines', () => {
    expect(noticeFor(events[7]!)).toBe('warning: placeholder %s missing in "Hello %s"')
    expect(noticeFor(events[8]!, run(9))).toBe('batch 2/9 skipped (25 entries): claude exited 1')
    expect(noticeFor(events[8]!)).toBe('batch 2/? skipped (25 entries): claude exited 1')
    expect(noticeFor(events[0]!)).toBe('Translating a.po: 210 of 300 entries selected')
  })

  it('returns nothing for routine events', () => {
    for (const e of [events[1], events[2], events[3], events[4], events[11]]) {
      expect(noticeFor(e!)).toBeUndefined()
    }
  })
})

interface FakeStream {
  isTTY: boolean
  chunks: string[]
  write(chunk: string): boolean
}

function fakeStream(isTTY: boolean): FakeStream {
  return {
    isTTY,
    chunks: [],
    write(chunk: string) {
      this.chunks.push(chunk)
      return true
    },
  }
}

describe('createProgressReporter', () => {
  it('prints plain lines when stderr is not a TTY', () => {
    const stream = fakeStream(false)
    const report = createProgressReporter(stream)
    for (const e of events) report(e)
    const out = stream.chunks.join('')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\x1b[')
    expect(out.split('\n').filter(Boolean)).toEqual([
      'Translating a.po: 210 of 300 entries selected',
      '[#---------] 12/210',
      '[##--------] 37/210  batch 1/9  fuzzy 3',
      'warning: placeholder %s missing in "Hello %s"',
      'batch 2/9 skipped (25 entries): claude exited 1',
      '[###-------] 62/210  batch 2/9  fuzzy 3',
      '[###-------] 67/210  batch 3/9  fuzzy 4',
    ])
  })

  it('rewrites a single line on a TTY and clears it when done', () => {
    const stream = fakeStream(true)
    const report = createProgressReporter(stream)
    for (const e of events.slice(0, 5)) report(e)
    const out = stream.chunks.join('')
    expect(out).toContain('\r\x1b[2K[#---------] 12/210  batch 1/9  fuzzy 0')
    expect(out).toContain('\r\x1b[2K[##--------] 37/210  batch 1/9  fuzzy 3')
    expect(out.endsWith('fuzzy 3')).toBe(true)
    expect(out.split('\n')).toHaveLength(2)

    report(events[7]!)
    const afterWarning = stream.chunks.slice(-2).join('')
    expect(afterWarning).toBe('\r\x1b[2Kwarning: placeholder %s missing in "Hello %s"\n\r\x1b[2K[##--------] 37/210  batch 1/9  fuzzy 3')

    report(events[11]!)
    expect(stream.chunks.at(-1)).toBe('\r\x1b[2K')
  })

  it('finish() clears a live TTY line once and is a no-op after done', () => {
    const stream = fakeStream(true)
    const report = createProgressReporter(stream)
    report(events[0]!)
    expect(stream.chunks.join('').endsWith('[----------] 0/210')).toBe(true)
    report.finish()
    expect(stream.chunks.at(-1)).toBe('\r\x1b[2K')
    report.finish()
    expect(stream.chunks.at(-1)).toBe('\r\x1b[2K')
    expect(stream.chunks.filter((c) => c === '\r\x1b[2K')).toHaveLength(1)

    const clean = fakeStream(true)
    const done = createProgressReporter(clean)
    for (const e of events) done(e)
    const before = clean.chunks.length
    done.finish()
    expect(clean.chunks.length).toBe(before)
  })

  it('finish() writes nothing on a non-TTY stream', () => {
    const stream = fakeStream(false)
    const report = createProgressReporter(stream)
    report(events[0]!)
    report.finish()
    expect(stream.chunks.join('')).toBe('Translating a.po: 210 of 300 entries selected\n')
  })

  it('does not emit a progress line for a tm-hit of zero', () => {
    const stream = fakeStream(false)
    const report = createProgressReporter(stream)
    report({ type: 'start', file: 'a.po', total: 3, pending: 3 })
    report({ type: 'tm-hit', count: 0 })
    expect(stream.chunks.join('')).toBe('Translating a.po: 3 of 3 entries selected\n')
  })
})

describe('batch phase reporting', () => {
  it('shows which half of the batch is running', () => {
    let state = applyEvent(initialProgress, { type: 'start', file: 'a.po', total: 10, pending: 10 })
    state = applyEvent(state, { type: 'batch-start', index: 1, of: 2, size: 5 })
    state = applyEvent(state, { type: 'batch-phase', index: 1, phase: 'drafting', at: 1000 })
    expect(formatProgress(state, 1000)).toMatch(/drafting/)

    state = applyEvent(state, { type: 'batch-phase', index: 1, phase: 'reviewing', at: 5000 })
    expect(formatProgress(state, 5000)).toMatch(/reviewing/)
    expect(formatProgress(state, 5000)).not.toMatch(/drafting/)
  })

  // The bar cannot move inside a batch, so the seconds are what tells the user the
  // run is alive rather than stuck on a subprocess.
  it('counts the seconds a phase has been running', () => {
    let state = applyEvent(initialProgress, { type: 'start', file: 'a.po', total: 10, pending: 10 })
    state = applyEvent(state, { type: 'batch-phase', index: 1, phase: 'reviewing', at: 1000 })

    expect(formatProgress(state, 1000)).toMatch(/reviewing 0s/)
    expect(formatProgress(state, 43_000)).toMatch(/reviewing 42s/)
  })

  it('drops the phase once the batch finishes', () => {
    let state = applyEvent(initialProgress, { type: 'start', file: 'a.po', total: 10, pending: 10 })
    state = applyEvent(state, { type: 'batch-phase', index: 1, phase: 'reviewing', at: 1000 })
    state = applyEvent(state, { type: 'batch-done', index: 1, translated: 5, fuzzy: 1 })
    expect(formatProgress(state, 9000)).not.toMatch(/reviewing/)
  })

  it('announces each phase on a non-tty so a redirected log still shows life', () => {
    const out = { isTTY: false, text: '', write(c: string) { this.text += c; return true } }
    const report = createProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, pending: 10 })
    report({ type: 'batch-start', index: 1, of: 2, size: 5 })
    report({ type: 'batch-phase', index: 1, phase: 'drafting', at: 1000 })
    report({ type: 'batch-phase', index: 1, phase: 'reviewing', at: 2000 })
    report.finish()

    expect(out.text).toMatch(/drafting/)
    expect(out.text).toMatch(/reviewing/)
  })
})

describe('createReviewProgressReporter', () => {
  function sink() {
    let text = ''
    return { isTTY: false, write: (c: string) => ((text += c), true), get text() { return text } }
  }

  it('reports the start line and a bar per batch on a non-tty', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 120, reviewable: 116 })
    report({ type: 'batch-start', index: 1, of: 5, size: 25 })
    report({ type: 'batch-done', index: 1, problems: 3 })
    report.finish()

    expect(out.text).toContain('Reviewing a.po')
    expect(out.text).toContain('116')
    expect(out.text).toMatch(/batch 1\/5/)
    expect(out.text).toMatch(/flagged 3/)
  })

  // of === 0 means no batch has started, not that every batch is finished.
  it('shows an empty bar before the first batch, not a full one', () => {
    const out = { isTTY: true, text: '', write(c: string) { this.text += c; return true } }
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 120, reviewable: 116 })
    report.finish()
    expect(out.text).toContain('[----------]')
    expect(out.text).not.toContain('[##########]')
  })

  it('accumulates flagged counts across batches', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, reviewable: 10 })
    report({ type: 'batch-done', index: 1, problems: 2 })
    report({ type: 'batch-done', index: 2, problems: 3 })
    report.finish()
    expect(out.text).toMatch(/flagged 5/)
  })

  it('says up front when it is picking up an interrupted run', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 2831, reviewable: 2805, resumed: 40 })
    report.finish()

    expect(out.text).toMatch(/resuming/i)
    expect(out.text).toContain('40')
  })

  it('says nothing about resuming on a run that starts from the top', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 120, reviewable: 116 })
    report.finish()

    expect(out.text).not.toMatch(/resuming/i)
  })

  // The batch clock is the only thing a long review shows; the estimate is what
  // tells the user whether to wait up or go to bed.
  it('projects the remaining time from finished batches', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    const t = 1_700_000_000_000
    report({ type: 'start', file: 'a.po', total: 125, reviewable: 125 })
    report({ type: 'batch-start', index: 1, of: 5, size: 25, at: t })
    report({ type: 'batch-done', index: 1, problems: 0, at: t + 60_000 })
    report({ type: 'batch-start', index: 2, of: 5, size: 25, at: t + 60_000 })
    report({ type: 'batch-done', index: 2, problems: 0, at: t + 120_000 })
    report.finish()

    // Three batches left at a minute each.
    expect(out.text).toMatch(/~3m left, done by /)
  })

  it('says nothing about remaining time until it has two batches to go on', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    const t = 1_700_000_000_000
    report({ type: 'start', file: 'a.po', total: 125, reviewable: 125 })
    report({ type: 'batch-start', index: 1, of: 5, size: 25, at: t })
    report({ type: 'batch-done', index: 1, problems: 0, at: t + 60_000 })
    report.finish()

    expect(out.text).not.toContain('left')
  })

  it('announces a failed batch', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, reviewable: 10 })
    report({ type: 'batch-failed', index: 2, size: 25, reason: 'claude exited with exit code 1' })
    report.finish()
    expect(out.text).toMatch(/batch 2/)
    expect(out.text).toContain('exit code 1')
  })
})

describe('estimateRemainingMs', () => {
  it('waits for a couple of samples before guessing', () => {
    expect(estimateRemainingMs([], 10)).toBeUndefined()
    expect(estimateRemainingMs([40_000], 10)).toBeUndefined()
  })

  it('multiplies the typical batch by what is left', () => {
    expect(estimateRemainingMs([40_000, 40_000], 10)).toBe(400_000)
  })

  // Throughput drifts over a long run (rate limits, batch complexity), and one
  // stalled batch should not dominate the estimate.
  it('uses a recent median, so an outlier does not skew it', () => {
    const durations = [40_000, 41_000, 300_000, 39_000, 40_000, 41_000]
    expect(estimateRemainingMs(durations, 2)).toBe(82_000)
  })

  it('returns nothing when there is nothing left', () => {
    expect(estimateRemainingMs([40_000, 40_000], 0)).toBeUndefined()
  })

  // Seen on a small file against a fast model: "~0s left" is noise, and the wait
  // is over before anyone has read it.
  it('says nothing when the wait is too short to be worth reporting', () => {
    expect(estimateRemainingMs([200, 200], 3)).toBeUndefined()
    expect(estimateRemainingMs([6_000, 6_000], 3)).toBe(18_000)
  })
})

describe('formatDuration', () => {
  it('drops to the largest useful unit', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(34 * 60_000)).toBe('34m')
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m')
  })

  it('rounds rather than truncating', () => {
    expect(formatDuration(89_000)).toBe('1m')
    expect(formatDuration(91_000)).toBe('2m')
  })
})
