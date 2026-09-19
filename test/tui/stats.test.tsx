import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { App } from '../../src/tui/App.js'
import { statsTarget } from '../../src/tui/screens/Stats.js'
import { DEFAULT_STATS_FILE, type StatsOptions } from '../../src/commands/stats.js'
import { openInDefaultApp } from '../../src/tui/open-file.js'
import { fakeCommands, keys, makeHome, render, tick, waitForText, type Home } from './helpers.js'

// The real one launches a browser. A test run must not open one.
vi.mock('../../src/tui/open-file.js', () => ({
  openInDefaultApp: vi.fn(() => true),
  openCommand: vi.fn(() => ({ command: 'open', args: [] })),
}))

let home: Home
let cwd: string

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  await mkdir(join(cwd, 'reports'))
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

async function openStats() {
  const commands = fakeCommands()
  const view = render(<App commands={commands} cwd={cwd} />)
  await tick()
  // Menu order puts statistics third.
  for (let i = 0; i < 3; i++) {
    view.stdin.write(keys.down)
    await tick()
  }
  view.stdin.write(keys.enter)
  await waitForText(view.lastFrame, 'Review statistics')
  return { ...view, commands }
}

describe('statsTarget', () => {
  it('puts the default name in the chosen folder', () => {
    expect(statsTarget('/tmp/out', '')).toBe(join('/tmp/out', DEFAULT_STATS_FILE))
    expect(statsTarget('/tmp/out', 'polyglots-stats.html')).toBe(join('/tmp/out', 'polyglots-stats.html'))
  })

  // Someone who knows exactly where they want it should not have to walk there.
  it('lets a typed path win over the chosen folder', () => {
    expect(statsTarget('/tmp/out', '/elsewhere/report.html')).toBe('/elsewhere/report.html')
    expect(statsTarget('/tmp/out', '../report.html')).toBe('/tmp/report.html')
  })

  it('ignores surrounding space rather than making a file named for it', () => {
    expect(statsTarget('/tmp/out', '  report.html  ')).toBe(join('/tmp/out', 'report.html'))
  })
})

describe('the statistics screen', () => {
  it('offers the folder it was started in', async () => {
    const { lastFrame } = await openStats()
    expect(lastFrame() ?? '').toContain(cwd)
  })

  it('writes into the folder chosen with tab', async () => {
    const view = await openStats()
    view.stdin.write(keys.tab)
    await waitForText(view.lastFrame, 'use this folder')

    // Rows: [ use this folder ], .., reports/. Enter on a folder walks into it,
    // which is what makes the top row the way to say "this one".
    for (let i = 0; i < 2; i++) {
      view.stdin.write(keys.down)
      await tick()
    }
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, join(cwd, 'reports'))

    // The cursor is back on the top row, so one more enter chooses this folder.
    view.stdin.write(keys.enter)
    // The path itself is not asserted here: ink wraps it across lines at this
    // width, so the call recorded below is what proves where the page went.
    await waitForText(view.lastFrame, 'choose folder')

    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, 'Wrote')
    const written = vi.mocked(view.commands.writeStats).mock.calls[0]![0] as StatsOptions
    expect(written.out).toBe(join(cwd, 'reports', DEFAULT_STATS_FILE))
  })

  it('goes back to the form when the picker is dismissed', async () => {
    const view = await openStats()
    view.stdin.write(keys.tab)
    await waitForText(view.lastFrame, 'use this folder')
    view.stdin.write(keys.esc)
    await waitForText(view.lastFrame, 'choose folder')
    expect(view.lastFrame() ?? '').toContain(cwd)
  })

  it('opens the page with o once it is written', async () => {
    const view = await openStats()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, 'o to open')
    view.stdin.write('o')
    await tick()
    expect(vi.mocked(openInDefaultApp)).toHaveBeenCalledWith(join(cwd, DEFAULT_STATS_FILE))
    expect(view.lastFrame() ?? '').toContain('Opening it now.')
  })

  // Nothing has been written yet, so there is nothing to aim a browser at.
  it('does nothing for o before the page exists', async () => {
    vi.mocked(openInDefaultApp).mockClear()
    const view = await openStats()
    view.stdin.write('o')
    await tick()
    expect(vi.mocked(openInDefaultApp)).not.toHaveBeenCalled()
  })
})
