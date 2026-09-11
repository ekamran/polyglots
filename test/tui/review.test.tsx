import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import type { ReviewEvent } from '../../src/types.js'
import { App } from '../../src/tui/App.js'
import { ReviewProgress, reduceReviewProgress } from '../../src/tui/components/ReviewProgress.js'
import { batchSizeChoices } from '../../src/tui/screens/Review.js'
import type { ReviewFile } from '../../src/tui/commands.js'
import {
  ESC_DELAY,
  fakeCommands,
  flat,
  keys,
  makeHome,
  render,
  reviewSummaryOf,
  tick,
  waitFor,
  waitForText,
  type Home,
} from './helpers.js'

let home: Home
let cwd: string

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  await writeFile(join(cwd, 'submission.po'), '')
  await writeFile(join(cwd, 'memory.tmx'), '')
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

const FILE = '/tmp/work/submission.po'

const events: ReviewEvent[] = [
  { type: 'start', file: FILE, total: 120, reviewable: 100 },
  { type: 'rules-done', flagged: 12, suspects: 20 },
  { type: 'batch-start', index: 1, of: 2, size: 44, at: 1_000_000 },
  { type: 'batch-done', index: 1, problems: 8, at: 1_060_000 },
  { type: 'batch-start', index: 2, of: 2, size: 44, at: 1_060_000 },
  { type: 'batch-failed', index: 2, size: 44, reason: 'claude exited with code 1', at: 1_120_000 },
  { type: 'written', file: '/tmp/work/submission-problems.po' },
  {
    type: 'done',
    summary: reviewSummaryOf(FILE, {
      total: 120,
      skipped: 20,
      reviewed: 100,
      problems: 64,
      approvable: 36,
      unreviewed: 44,
      byRule: { 'title-case': 9, glossary: 7, placeholder: 4 },
      problemsFile: '/tmp/work/submission-problems.po',
    }),
  },
]

describe('reduceReviewProgress', () => {
  it('accumulates rule findings, batch position and problems', () => {
    const state = reduceReviewProgress(events.slice(0, 4))
    expect(state).toMatchObject({
      started: true,
      file: FILE,
      total: 120,
      reviewable: 100,
      ruleFlagged: 12,
      suspects: 20,
      problems: 20,
      batchesDone: 1,
      batchesTotal: 2,
    })
    expect(state.failures).toEqual([])
    expect(state.summary).toBeUndefined()
  })

  it('records a failed batch as unreviewed without losing the run', () => {
    const state = reduceReviewProgress(events)
    expect(state.unreviewed).toBe(44)
    expect(state.failures).toEqual(['Batch 2 failed (44 entries): claude exited with code 1'])
    expect(state.summary?.problems).toBe(64)
  })
})

// An interrupted run leaves batches already done. Counting the bar from zero
// would tell the user they are three hours behind where they actually are.
describe('reduceReviewProgress on a resumed run', () => {
  const resumed: ReviewEvent[] = [
    { type: 'start', file: FILE, total: 200, reviewable: 200, resumed: 40 },
    { type: 'batch-start', index: 41, of: 50, size: 25, at: 1_000_000 },
    { type: 'batch-done', index: 41, problems: 2, at: 1_060_000 },
  ]

  it('counts the batches the earlier run finished as done', () => {
    expect(reduceReviewProgress(resumed)).toMatchObject({ batchesDone: 41, batchesTotal: 50, resumed: 40 })
  })

  it('says on screen that it picked up an earlier run', () => {
    const frame = flat(render(<ReviewProgress events={resumed} />).lastFrame())
    expect(frame).toMatch(/resum\w+ after 40 batches/i)
  })

  // The earlier run's pace is unknown and probably not this one's.
  it('estimates from the batches this run timed, not the ones it inherited', () => {
    const state = reduceReviewProgress([
      ...resumed,
      { type: 'batch-start', index: 42, of: 50, size: 25, at: 1_060_000 },
      { type: 'batch-done', index: 42, problems: 0, at: 1_120_000 },
    ])
    expect(state.batchDurations).toEqual([60_000, 60_000])
    expect(state.remainingMs).toBe(8 * 60_000)
  })
})

describe('ReviewProgress remaining time', () => {
  const timed = (n: number, ms: number): ReviewEvent[] => {
    const out: ReviewEvent[] = [{ type: 'start', file: FILE, total: 200, reviewable: 200 }]
    let t = 1_000_000
    for (let i = 1; i <= n; i++) {
      out.push({ type: 'batch-start', index: i, of: 8, size: 25, at: t })
      t += ms
      out.push({ type: 'batch-done', index: i, problems: 1, at: t })
    }
    out.push({ type: 'batch-start', index: n + 1, of: 8, size: 25, at: t })
    return out
  }

  it('estimates what is left once it has a couple of batches to go on', () => {
    const state = reduceReviewProgress(timed(3, 60_000))
    expect(state.batchDurations).toEqual([60_000, 60_000, 60_000])
    expect(state.remainingMs).toBe(5 * 60_000)
  })

  // Two batches into a 114-batch run is half an hour of silence. The guess is
  // rough and says so by changing as soon as a real batch lands.
  it('guesses from a default pace before any batch has finished', () => {
    const state = reduceReviewProgress([
      { type: 'start', file: FILE, total: 2831, reviewable: 2805 },
      { type: 'batch-start', index: 1, of: 114, size: 25, at: 1_000_000 },
    ])
    expect(state.remainingMs).toBe(114 * 25 * 4_000)
  })

  it('replaces the guess with the first batch it actually timed', () => {
    expect(reduceReviewProgress(timed(1, 60_000)).remainingMs).toBe(7 * 60_000)
  })

  it('has nothing to guess from before the first batch is announced', () => {
    const state = reduceReviewProgress([{ type: 'start', file: FILE, total: 2831, reviewable: 2805 }])
    expect(state.remainingMs).toBeUndefined()
  })

  it('ignores events with no timestamp rather than producing nonsense', () => {
    const state = reduceReviewProgress([
      { type: 'start', file: FILE, total: 50, reviewable: 50 },
      { type: 'batch-start', index: 1, of: 2, size: 25 } as ReviewEvent,
      { type: 'batch-done', index: 1, problems: 0 } as ReviewEvent,
    ])
    // Nothing was timed, so nothing is measured; the estimate falls back to the
    // default pace rather than to NaN.
    expect(state.batchDurations).toEqual([])
    expect(state.remainingMs).toBe(1 * 25 * 4_000)
  })

  it('shows the estimate and a finish time in the line', () => {
    const { lastFrame } = render(<ReviewProgress events={timed(3, 60_000)} />)
    const frame = flat(lastFrame())
    expect(frame).toMatch(/5m left/)
    expect(frame).toMatch(/\d{1,2}[:.]\d{2}/)
  })
})

describe('ReviewProgress in-flight clock', () => {
  it('marks a batch as in flight once it starts and not before', () => {
    const before = reduceReviewProgress([{ type: 'start', file: FILE, total: 10, reviewable: 10 }])
    expect(before.inFlight).toBe(false)

    const during = reduceReviewProgress([
      { type: 'start', file: FILE, total: 10, reviewable: 10 },
      { type: 'batch-start', index: 1, of: 4, size: 25, at: 1000 },
    ])
    expect(during.inFlight).toBe(true)

    const after = reduceReviewProgress([
      { type: 'start', file: FILE, total: 10, reviewable: 10 },
      { type: 'batch-start', index: 1, of: 4, size: 25, at: 1000 },
      { type: 'batch-done', index: 1, problems: 2, at: 2000 },
    ])
    expect(after.inFlight).toBe(false)
  })

  // Two counters (batches done and batch in flight) read as a contradiction; the
  // bar already shows the completed fraction, so the text says what is happening.
  it('shows one counter, not both, while a batch is in flight', () => {
    const { lastFrame } = render(
      <ReviewProgress
        events={[
          { type: 'start', file: FILE, total: 200, reviewable: 200 },
          { type: 'batch-start', index: 1, of: 8, size: 25, at: 1_000_000 },
          { type: 'batch-done', index: 1, problems: 1, at: 1_060_000 },
          { type: 'batch-start', index: 2, of: 8, size: 25, at: 1_060_000 },
          { type: 'batch-done', index: 2, problems: 2, at: 1_120_000 },
          { type: 'batch-start', index: 3, of: 8, size: 25, at: 1_120_000 },
        ]}
      />,
    )
    const frame = flat(lastFrame())
    expect(frame).toMatch(/batch 3\/8/)
    expect(frame).not.toMatch(/2\/8/)
  })

  it('falls back to a completed count when no batch is running', () => {
    const { lastFrame } = render(
      <ReviewProgress
        events={[
          { type: 'start', file: FILE, total: 200, reviewable: 200 },
          { type: 'batch-start', index: 1, of: 8, size: 25, at: 1_000_000 },
          { type: 'batch-done', index: 1, problems: 1, at: 1_060_000 },
        ]}
      />,
    )
    expect(flat(lastFrame())).toMatch(/1\/8/)
  })

  // A batch is a single claude call taking minutes; without this the bar sits at
  // the same fraction with no way to tell work from a wedged subprocess.
  it('shows the batch it is waiting on while one is in flight', () => {
    const { lastFrame } = render(
      <ReviewProgress
        events={[
          { type: 'start', file: FILE, total: 100, reviewable: 100 },
          { type: 'batch-start', index: 1, of: 4, size: 25, at: 1_000_000 },
        ]}
      />,
    )
    expect(flat(lastFrame())).toMatch(/batch 1\/4/)
    expect(flat(lastFrame())).toMatch(/\d+s/)
  })
})

describe('ReviewProgress needs-your-eye', () => {
  it('reports entries only the human can judge after a rules-only run', () => {
    const summary = reviewSummaryOf('plugin-tr.po', { problems: 2, needsReview: 7, approvable: 40 })
    const { lastFrame } = render(<ReviewProgress events={[{ type: 'start', file: 'plugin-tr.po', total: 49, reviewable: 49 }, { type: 'done', summary }]} />)
    expect(lastFrame() ?? '').toMatch(/7 of those are unadjudicated/i)
  })
})

describe('ReviewProgress', () => {
  it('renders a bar over batches with a running problem count', async () => {
    const { lastFrame } = render(<ReviewProgress events={events.slice(0, 4)} />)
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/▰+▱+ 1\/2/)
    expect(frame).toContain('problems 20')
    expect(frame).not.toContain('Done.')
  })

  it('renders the failed batch line', async () => {
    const { lastFrame } = render(<ReviewProgress events={events} />)
    await tick()
    expect(lastFrame()).toContain('Batch 2 failed (44 entries): claude exited with code 1')
  })

  it('renders the summary with the rule breakdown and the problems path', async () => {
    const { lastFrame } = render(<ReviewProgress events={events} />)
    await tick()
    const frame = flat(lastFrame())
    expect(frame).toContain('64 problems')
    expect(frame).toContain('36 approvable')
    expect(frame).toContain('44 unreviewed')
    expect(frame).toContain('title-case 9')
    expect(frame).toContain('glossary 7')
    expect(frame).toContain('/tmp/work/submission-problems.po')
    expect(frame).not.toContain('-report.md')
  })

  // Repaired entries are written fuzzy, and fuzzy is what `translate` selects, so
  // telling the user to run it over this file re-translates every repair the
  // review just made. The repair exists in no other file.
  it('sends the user to PoEdit rather than back through translate', async () => {
    const { lastFrame } = render(<ReviewProgress events={events} />)
    await tick()
    const frame = flat(lastFrame())
    expect(frame).not.toContain('polyglots translate')
    expect(frame).toMatch(/PoEdit/i)
  })

  it('says the submission is clean when nothing was flagged', async () => {
    const clean: ReviewEvent[] = [
      { type: 'start', file: FILE, total: 10, reviewable: 10 },
      {
        type: 'done',
        summary: reviewSummaryOf(FILE, {
          total: 10,
          skipped: 0,
          reviewed: 10,
          problems: 0,
          approvable: 10,
          unreviewed: 0,
          byRule: {},
          problemsFile: undefined,
        }),
      },
    ]
    const { lastFrame } = render(<ReviewProgress events={clean} />)
    await tick()
    const frame = flat(lastFrame())
    expect(frame).toMatch(/nothing flagged|no problems/i)
    expect(frame).toContain('10 approvable')
    expect(frame).not.toContain('problems.po')
  })

  it('omits the unreviewed count when every batch succeeded', async () => {
    const { lastFrame } = render(
      <ReviewProgress
        events={[
          { type: 'start', file: FILE, total: 10, reviewable: 10 },
          { type: 'done', summary: reviewSummaryOf(FILE, { unreviewed: 0 }) },
        ]}
      />,
    )
    await tick()
    expect(flat(lastFrame())).not.toContain('unreviewed')
  })

  it('reports repairs in the summary', () => {
    const repairEvents: ReviewEvent[] = [
      { type: 'start', file: FILE, total: 120, reviewable: 100 },
      { type: 'done', summary: reviewSummaryOf(FILE, { problems: 40, approvable: 60, repaired: 33 }) },
    ]
    expect(flat(render(<ReviewProgress events={repairEvents} />).lastFrame())).toMatch(/33 repaired/)
  })

  // Whitespace-only fixes are written but count as neither a problem nor a
  // needsReview entry, so flagged (problems + needsReview) undercounts what
  // was written. Subtracting repaired from flagged instead of written would
  // print a negative "left for you" here.
  it('never goes negative when everything written was a mechanical fix', () => {
    const wsEvents: ReviewEvent[] = [
      { type: 'start', file: FILE, total: 10, reviewable: 10 },
      {
        type: 'done',
        summary: reviewSummaryOf(FILE, { problems: 0, needsReview: 0, approvable: 10, repaired: 10, written: 10 }),
      },
    ]
    const frame = flat(render(<ReviewProgress events={wsEvents} />).lastFrame())
    expect(frame).toContain('10 repaired, 0 left for you')
    expect(frame).not.toMatch(/-\d+ left for you/)
  })
})

describe('batchSizeChoices', () => {
  it('offers a ladder from a small batch to a large one', () => {
    expect(batchSizeChoices(25)).toEqual([10, 25, 50, 75, 100])
  })

  // Otherwise a locale team that set an unusual default in config.json could not
  // get back to it after one keypress.
  it('keeps a configured size reachable, in its place on the ladder', () => {
    expect(batchSizeChoices(40)).toEqual([10, 25, 40, 50, 75, 100])
    expect(batchSizeChoices(200)).toEqual([10, 25, 50, 75, 100, 200])
  })
})

describe('Review screen', () => {
  const openReview = async (commands = fakeCommands()) => {
    const view = render(<App commands={commands} cwd={cwd} />)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, 'submission.po')
    return view
  }

  // The picker highlights '..' first, so the file needs one step down.
  const pickFile = async (view: { stdin: { write(d: string): void }; lastFrame: () => string | undefined }) => {
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Locale/)
  }

  it('filters the picker to .po files', async () => {
    const { lastFrame } = await openReview()
    expect(lastFrame()).toContain('submission.po')
    expect(lastFrame()).not.toContain('memory.tmx')
  })

  it('defaults the locale from the config', async () => {
    await mkdir(join(home.path, 'config'), { recursive: true })
    await writeFile(join(home.path, 'config', 'config.json'), JSON.stringify({ defaultLocale: 'de' }))
    const view = await openReview()
    await pickFile(view)
    expect(view.lastFrame()).toContain('de')
  })

  it('passes the picked file, locale and AI choice to the command', async () => {
    const reviewFile = vi.fn<ReviewFile>(async (opts) => {
      opts.onProgress?.({ type: 'start', file: opts.file, total: 3, reviewable: 3 })
      opts.onProgress?.({ type: 'done', summary: reviewSummaryOf(opts.file) })
      return reviewSummaryOf(opts.file)
    })
    const view = await openReview(fakeCommands({ reviewFile }))
    await pickFile(view)
    const { lastFrame, stdin } = view

    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(' ')
    await waitForText(lastFrame, /Skip AI checks:\s*yes/i)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)

    await waitFor(() => reviewFile.mock.calls.length > 0)
    expect(reviewFile.mock.calls[0]?.[0]).toMatchObject({
      file: join(cwd, 'submission.po'),
      locale: 'tr',
      noAi: true,
    })
  })

  it('defaults the batch size from the config', async () => {
    await mkdir(join(home.path, 'config'), { recursive: true })
    await writeFile(join(home.path, 'config', 'config.json'), JSON.stringify({ batchSize: 50 }))
    const view = await openReview()
    await pickFile(view)

    expect(flat(view.lastFrame())).toMatch(/Batch size:\s*50/)
  })

  // A whole-night review is where batch size actually matters: fewer, larger
  // calls finish sooner, and the CLI flag is no help from inside the TUI.
  it('passes the chosen batch size to the command', async () => {
    const reviewFile = vi.fn<ReviewFile>(async (opts) => {
      opts.onProgress?.({ type: 'done', summary: reviewSummaryOf(opts.file) })
      return reviewSummaryOf(opts.file)
    })
    const view = await openReview(fakeCommands({ reviewFile }))
    await pickFile(view)
    const { lastFrame, stdin } = view

    stdin.write(keys.down)
    await tick()
    stdin.write(keys.right)
    await waitForText(lastFrame, /Batch size:\s*50/)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)

    await waitFor(() => reviewFile.mock.calls.length > 0)
    expect(reviewFile.mock.calls[0]?.[0]).toMatchObject({ batchSize: 50 })
  })

  // Without this the TUI has no answer to a refused resume: the message names
  // starting over, and there would be no way to do it.
  it('passes the start-over choice to the command', async () => {
    const reviewFile = vi.fn<ReviewFile>(async (opts) => {
      opts.onProgress?.({ type: 'done', summary: reviewSummaryOf(opts.file) })
      return reviewSummaryOf(opts.file)
    })
    const view = await openReview(fakeCommands({ reviewFile }))
    await pickFile(view)
    const { lastFrame, stdin } = view

    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(' ')
    await waitForText(lastFrame, /Start over:\s*yes/i)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)

    await waitFor(() => reviewFile.mock.calls.length > 0)
    expect(reviewFile.mock.calls[0]?.[0]).toMatchObject({ fresh: true })
  })

  it('resumes an interrupted review unless told to start over', async () => {
    const reviewFile = vi.fn<ReviewFile>(async (opts) => {
      opts.onProgress?.({ type: 'done', summary: reviewSummaryOf(opts.file) })
      return reviewSummaryOf(opts.file)
    })
    const view = await openReview(fakeCommands({ reviewFile }))
    await pickFile(view)

    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.enter)

    await waitFor(() => reviewFile.mock.calls.length > 0)
    expect(reviewFile.mock.calls[0]?.[0]).toMatchObject({ fresh: false })
  })

  it('shows the summary when the run finishes', async () => {
    const view = await openReview()
    await pickFile(view)
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /approvable/)
  })

  it('returns to the menu with escape before a run starts', async () => {
    const { lastFrame, stdin } = await openReview()
    stdin.write(keys.esc)
    await tick(ESC_DELAY)
    await waitForText(lastFrame, 'Configure API keys')
  })
})
