import { describe, expect, it } from 'vitest'
import React from 'react'
import type { TranslateEvent } from '../../src/commands/translate.js'
import { Progress, reduceProgress } from '../../src/tui/components/Progress.js'
import { render, tick } from './helpers.js'

const FILE = '/tmp/work/plugin-tr.po'

const events: TranslateEvent[] = [
  { type: 'start', file: FILE, total: 10, pending: 6 },
  { type: 'tm-hit', count: 2 },
  { type: 'saved' },
  { type: 'batch-start', index: 1, of: 2, size: 2 },
  { type: 'batch-done', index: 1, translated: 2, fuzzy: 1 },
  { type: 'saved' },
  { type: 'warning', message: 'placeholder %s missing in draft' },
  { type: 'batch-start', index: 2, of: 2, size: 2 },
  { type: 'batch-skipped', index: 2, size: 2, reason: 'claude exited with code 1' },
  {
    type: 'done',
    summary: { file: FILE, total: 10, pending: 6, fromTm: 2, translated: 2, fuzzy: 1, skipped: 2 },
  },
]

describe('reduceProgress', () => {
  it('accumulates counts, batch position and warnings', () => {
    const state = reduceProgress(events.slice(0, 7))
    expect(state).toMatchObject({
      file: FILE,
      total: 10,
      pending: 6,
      fromTm: 2,
      translated: 2,
      fuzzy: 1,
      skipped: 0,
      done: 4,
      batch: { index: 1, of: 2 },
    })
    expect(state.warnings).toEqual(['placeholder %s missing in draft'])
    expect(state.summary).toBeUndefined()
  })

  it('records skipped batches as warnings and keeps the final summary', () => {
    const state = reduceProgress(events)
    expect(state.done).toBe(6)
    expect(state.skipped).toBe(2)
    expect(state.warnings).toEqual(['placeholder %s missing in draft', 'Batch 2 skipped (2 entries): claude exited with code 1'])
    expect(state.summary?.skipped).toBe(2)
  })
})

describe('Progress', () => {
  it('renders a bar with counts while running', async () => {
    const { lastFrame } = render(<Progress events={events.slice(0, 5)} />)
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/▰+▱+ 4\/6/)
    expect(frame).toContain('batch 1/2')
    expect(frame).toContain('fuzzy 1')
    expect(frame).not.toContain('Done.')
  })

  it('renders warnings and the final summary', async () => {
    const { lastFrame } = render(<Progress events={events} />)
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/▰{20} 6\/6/)
    expect(frame).toContain('placeholder %s missing in draft')
    expect(frame).toContain('Batch 2 skipped (2 entries): claude exited with code 1')
    expect(frame).toContain('Done. 2 translated, 1 fuzzy, 2 from TM, 2 skipped.')
    expect(frame).toContain(`Open ${FILE} in PoEdit to review.`)
  })

  it('shows the stop reason when the run was halted', async () => {
    const stopped: TranslateEvent[] = [
      { type: 'start', file: FILE, total: 10, pending: 6 },
      { type: 'tm-hit', count: 0 },
      { type: 'batch-start', index: 1, of: 3, size: 2 },
      {
        type: 'done',
        summary: { file: FILE, total: 10, pending: 6, fromTm: 0, translated: 0, fuzzy: 0, skipped: 0, stopped: 'DeepL quota exceeded' },
      },
    ]
    const { lastFrame } = render(<Progress events={stopped} />)
    await tick()
    expect(lastFrame()).toContain('Stopped: DeepL quota exceeded')
    expect(lastFrame()).toContain('Done. 0 translated')
  })

  it('takes the counts from the summary when no batch events were seen', async () => {
    const sparse: TranslateEvent[] = [
      { type: 'start', file: FILE, total: 10, pending: 4 },
      { type: 'done', summary: { file: FILE, total: 10, pending: 4, fromTm: 1, translated: 3, fuzzy: 1, skipped: 0 } },
    ]
    const { lastFrame } = render(<Progress events={sparse} />)
    await tick()
    expect(lastFrame()).toMatch(/▰{20} 4\/4/)
    expect(lastFrame()).toContain('fuzzy 1')
  })

  it('renders a waiting line before the start event', async () => {
    const { lastFrame } = render(<Progress events={[]} />)
    await tick()
    expect(lastFrame()).toMatch(/Loading|Starting/)
  })
})
