import { describe, expect, it } from 'vitest'
import type { TranslateEvent } from '../../src/commands/translate.js'
import { applyEvent, createProgressReporter, formatProgress, initialProgress, noticeFor, createReviewProgressReporter, estimateRemainingMs, formatDuration, renderBar } from '../../src/cli/progress.js'

const T = 1_700_000_000_000

const events: TranslateEvent[] = [
  { type: 'start', file: 'a.po', total: 300, pending: 210 },
  { type: 'tm-hit', count: 12 },
  { type: 'saved' },
  { type: 'batch-start', index: 1, of: 9, size: 25, at: T },
  { type: 'batch-done', index: 1, translated: 25, fuzzy: 3, at: T + 60_000 },
  { type: 'saved' },
  { type: 'batch-start', index: 2, of: 9, size: 25, at: T + 60_000 },
  { type: 'warning', message: 'placeholder %s missing in "Hello %s"' },
  { type: 'batch-skipped', index: 2, size: 25, reason: 'claude exited 1', at: T + 90_000 },
  { type: 'batch-start', index: 3, of: 9, size: 25, at: T + 90_000 },
  { type: 'batch-done', index: 3, translated: 5, fuzzy: 1, at: T + 150_000 },
  { type: 'done', summary: { file: 'a.po', total: 300, pending: 210, fromTm: 12, translated: 30, fuzzy: 4, skipped: 25 } },
]

function run(upTo: number) {
  return events.slice(0, upTo).reduce(applyEvent, initialProgress)
}

// The remaining-time estimate has its own tests below and ends in a wall clock,
// so it is stripped where a line is compared exactly. It is always last on the
// line.
// Lines on a TTY are separated by \r, not \n, so the match has to stop at both.
const noEta = (text: string) => text.replace(/ {2}~[^\n\r]*/g, '')

describe('renderBar', () => {
  it('fills in proportion to the work done', () => {
    expect(renderBar(0, 4, 4)).toBe('▱▱▱▱')
    expect(renderBar(2, 4, 4)).toBe('▰▰▱▱')
    expect(renderBar(4, 4, 4)).toBe('▰▰▰▰')
  })

  // Rounding alone fills the last cell well before the work is finished, and a
  // full bar on a run with entries left to go reads as a hang.
  it('keeps the last cell empty until the work is actually done', () => {
    expect(renderBar(39, 40, 20)).toBe('▰'.repeat(19) + '▱')
    expect(renderBar(40, 40, 20)).toBe('▰'.repeat(20))
  })

  it('is full when there is nothing to do', () => {
    expect(renderBar(0, 0, 4)).toBe('▰▰▰▰')
  })

  it('does not run past its width on a count that overshoots', () => {
    expect(renderBar(9, 4, 4)).toBe('▰▰▰▰')
  })
})

describe('formatProgress', () => {
  it('renders an empty bar before any work', () => {
    expect(formatProgress(run(1))).toBe('▱▱▱▱▱▱▱▱▱▱ 0/210')
  })

  it('counts TM hits as processed', () => {
    expect(formatProgress(run(2))).toBe('▰▱▱▱▱▱▱▱▱▱ 12/210')
  })

  it('shows the current batch and fuzzy count once batching starts', () => {
    expect(noEta(formatProgress(run(4)))).toBe('▰▱▱▱▱▱▱▱▱▱ 12/210  batch 1/9  fuzzy 0')
    expect(noEta(formatProgress(run(5)))).toBe('▰▰▱▱▱▱▱▱▱▱ 37/210  batch 1/9  fuzzy 3')
  })

  it('counts skipped batches as processed', () => {
    expect(noEta(formatProgress(run(9)))).toBe('▰▰▰▱▱▱▱▱▱▱ 62/210  batch 2/9  fuzzy 3')
    expect(noEta(formatProgress(run(11)))).toBe('▰▰▰▱▱▱▱▱▱▱ 67/210  batch 3/9  fuzzy 4')
  })

  it('renders a full bar when nothing is pending', () => {
    const state = applyEvent(initialProgress, { type: 'start', file: 'x.po', total: 5, pending: 0 })
    expect(formatProgress(state)).toBe('▰▰▰▰▰▰▰▰▰▰ 0/0')
  })

  it('never rounds a partial run up to a full bar', () => {
    let state = applyEvent(initialProgress, { type: 'start', file: 'x.po', total: 100, pending: 100 })
    state = applyEvent(state, { type: 'tm-hit', count: 99 })
    expect(formatProgress(state)).toBe('▰▰▰▰▰▰▰▰▰▱ 99/100')
  })
})

// Same treatment as review: a translate batch is two long calls, and without an
// estimate the only question the user has ("can I go to bed?") is unanswerable.
describe('formatProgress remaining time', () => {
  it('has nothing to go on before the first batch is announced', () => {
    expect(formatProgress(run(2))).not.toContain('left')
  })

  it('guesses from a default pace as soon as the first batch starts', () => {
    // Nine batches left of 25 entries, at the default four seconds an entry.
    expect(formatProgress(run(4))).toMatch(/~15m left, done by /)
  })

  it('projects from the batches it has actually timed', () => {
    // One 60s batch done, eight to go.
    expect(formatProgress(run(5))).toMatch(/~8m left, done by /)
  })

  it('counts a skipped batch as time spent, since it was', () => {
    // 60s and 30s timed, seven to go, median 60s.
    expect(formatProgress(run(9))).toMatch(/~7m left, done by /)
  })

  it('drops the estimate once the last batch is in', () => {
    const state = (
      [
        { type: 'start', file: 'a.po', total: 50, pending: 50 },
        { type: 'batch-start', index: 1, of: 1, size: 50, at: T },
        { type: 'batch-done', index: 1, translated: 50, fuzzy: 0, at: T + 60_000 },
      ] satisfies TranslateEvent[]
    ).reduce(applyEvent, initialProgress)
    expect(formatProgress(state)).not.toContain('left')
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
    expect(noEta(out).split('\n').filter(Boolean)).toEqual([
      'Translating a.po: 210 of 300 entries selected',
      '▰▱▱▱▱▱▱▱▱▱ 12/210',
      '▰▰▱▱▱▱▱▱▱▱ 37/210  batch 1/9  fuzzy 3',
      'warning: placeholder %s missing in "Hello %s"',
      'batch 2/9 skipped (25 entries): claude exited 1',
      '▰▰▰▱▱▱▱▱▱▱ 62/210  batch 2/9  fuzzy 3',
      '▰▰▰▱▱▱▱▱▱▱ 67/210  batch 3/9  fuzzy 4',
    ])
  })

  it('rewrites a single line on a TTY and clears it when done', () => {
    const stream = fakeStream(true)
    const report = createProgressReporter(stream)
    for (const e of events.slice(0, 5)) report(e)
    const out = stream.chunks.join('')
    expect(out).toContain('\r\x1b[2K▰▱▱▱▱▱▱▱▱▱ 12/210  batch 1/9  fuzzy 0')
    expect(out).toContain('\r\x1b[2K▰▰▱▱▱▱▱▱▱▱ 37/210  batch 1/9  fuzzy 3')
    expect(noEta(out).endsWith('fuzzy 3')).toBe(true)
    expect(out.split('\n')).toHaveLength(2)

    report(events[7]!)
    const afterWarning = noEta(stream.chunks.slice(-2).join(''))
    expect(afterWarning).toBe('\r\x1b[2Kwarning: placeholder %s missing in "Hello %s"\n\r\x1b[2K▰▰▱▱▱▱▱▱▱▱ 37/210  batch 1/9  fuzzy 3')

    report(events[11]!)
    expect(stream.chunks.at(-1)).toBe('\r\x1b[2K')
  })

  it('finish() clears a live TTY line once and is a no-op after done', () => {
    const stream = fakeStream(true)
    const report = createProgressReporter(stream)
    report(events[0]!)
    expect(stream.chunks.join('').endsWith('▱▱▱▱▱▱▱▱▱▱ 0/210')).toBe(true)
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
    state = applyEvent(state, { type: 'batch-start', index: 1, of: 2, size: 5, at: 1000 })
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
    state = applyEvent(state, { type: 'batch-done', index: 1, translated: 5, fuzzy: 1, at: 9000 })
    expect(formatProgress(state, 9000)).not.toMatch(/reviewing/)
  })

  it('announces each phase on a non-tty so a redirected log still shows life', () => {
    const out = { isTTY: false, text: '', write(c: string) { this.text += c; return true } }
    const report = createProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, pending: 10 })
    report({ type: 'batch-start', index: 1, of: 2, size: 5, at: 1000 })
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
    report({ type: 'batch-start', index: 1, of: 5, size: 25, at: 1000 })
    report({ type: 'batch-done', index: 1, problems: 3, at: 5000 })
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
    expect(out.text).toContain('▱▱▱▱▱▱▱▱▱▱')
    expect(out.text).not.toContain('▰▰▰▰▰▰▰▰▰▰')
  })

  it('accumulates flagged counts across batches', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, reviewable: 10 })
    report({ type: 'batch-done', index: 1, problems: 2, at: 1000 })
    report({ type: 'batch-done', index: 2, problems: 3, at: 2000 })
    report.finish()
    expect(out.text).toMatch(/flagged 5/)
  })

  // Resume is per entry and lives in the job store: a resumed run has fewer
  // entries to batch and nothing to announce about batches it inherited.
  it('says nothing about resuming, which is no longer a thing a run does', () => {
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

  // The whole point of the estimate is deciding whether to wait up, which is a
  // decision the user makes at the start, not an hour in.
  it('has an estimate from the first batch, before any of them has finished', () => {
    const out = { isTTY: true, text: '', write(c: string) { this.text += c; return true } }
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 2831, reviewable: 2805 })
    report({ type: 'batch-start', index: 1, of: 114, size: 25, at: 1_700_000_000_000 })
    report.finish()

    expect(out.text).toMatch(/left, done by /)
  })

  it('has nothing to estimate from before the first batch is announced', () => {
    const out = { isTTY: true, text: '', write(c: string) { this.text += c; return true } }
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 2831, reviewable: 2805 })
    report.finish()

    expect(out.text).not.toContain('left')
  })

  it('announces a failed batch', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, reviewable: 10 })
    report({ type: 'batch-failed', index: 2, size: 25, reason: 'claude exited with exit code 1', at: 1000 })
    report.finish()
    expect(out.text).toMatch(/batch 2/)
    expect(out.text).toContain('exit code 1')
  })
})

describe('estimateRemainingMs', () => {
  // On a 114-batch submission, waiting for two batches to land before saying
  // anything is half an hour of silence. A guess from a default pace is worth
  // more than that, and it is replaced the moment a real batch lands.
  it('guesses from a default pace before it has timed anything', () => {
    expect(estimateRemainingMs([], 10, 25)).toBe(10 * 25 * 4_000)
  })

  it('drops the guess as soon as one real batch has been timed', () => {
    expect(estimateRemainingMs([40_000], 10, 25)).toBe(400_000)
  })

  it('scales the guess with the batch size, since a batch is one call over its entries', () => {
    expect(estimateRemainingMs([], 10, 50)).toBe(2 * estimateRemainingMs([], 10, 25)!)
  })

  it('says nothing when it has neither a measurement nor a batch size', () => {
    expect(estimateRemainingMs([], 10)).toBeUndefined()
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
