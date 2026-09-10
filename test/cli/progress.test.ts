import { describe, expect, it } from 'vitest'
import type { TranslateEvent } from '../../src/commands/translate.js'
import { applyEvent, createProgressReporter, formatProgress, initialProgress, noticeFor, createReviewProgressReporter } from '../../src/cli/progress.js'

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

  it('accumulates flagged counts across batches', () => {
    const out = sink()
    const report = createReviewProgressReporter(out)
    report({ type: 'start', file: 'a.po', total: 10, reviewable: 10 })
    report({ type: 'batch-done', index: 1, problems: 2 })
    report({ type: 'batch-done', index: 2, problems: 3 })
    report.finish()
    expect(out.text).toMatch(/flagged 5/)
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
