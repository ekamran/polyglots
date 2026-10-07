import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { App } from '../../src/tui/App.js'
import { digitsOnly } from '../../src/tui/screens/Split.js'
import type { SplitOptions } from '../../src/commands/split.js'
import { fakeCommands, openFromHome, keys, makeHome, render, tick, waitForText, cleanup, type Home } from './helpers.js'

let home: Home
let cwd: string

const HEADER = `msgid ""
msgstr ""
"Language: tr\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
`

// Twelve entries, so a size of 5 is a visible three parts with a short tail.
const CATALOGUE = [HEADER, ...Array.from({ length: 12 }, (_, i) => `msgid "S${i + 1}"\nmsgstr "K${i + 1}"\n`)].join('\n')

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  await writeFile(join(cwd, 'plugin-tr.po'), CATALOGUE)
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

// Clears the default size and types a new one.
async function typeSize(stdin: { write: (s: string) => void }, value: string) {
  // One key per tick: ink handles a single input event per render, so a burst
  // written without yielding is coalesced and most of it is lost.
  for (let i = 0; i < 4; i++) {
    stdin.write(keys.backspace)
    await tick()
  }
  for (const ch of value) {
    stdin.write(ch)
    await tick()
  }
}

async function openSplit(commands = fakeCommands()) {
  const view = render(<App commands={commands} cwd={cwd} />)
  await tick()
  await openFromHome(view.stdin, 'split')
  await waitForText(view.lastFrame, 'Split')
  return view
}

// The picker pins .. at the top, so the catalogue is one row down.
async function pickFile(view: { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined }) {
  view.stdin.write(keys.down)
  await tick()
  view.stdin.write(keys.enter)
  await waitForText(view.lastFrame, 'entries')
}

describe('digitsOnly', () => {
  // The value is compared against an entry count and used to slice, so a stray
  // character would surface later as NaN parts.
  it('keeps only digits', () => {
    expect(digitsOnly('5o0')).toBe('50')
    expect(digitsOnly('-12')).toBe('12')
    expect(digitsOnly('abc')).toBe('')
  })
})

describe('the split screen', () => {
  it('counts the file before asking how to cut it', async () => {
    const view = await openSplit()
    await pickFile(view)
    expect(view.lastFrame() ?? '').toContain('12 entries')
  })

  // Choosing a run size is the whole point, and the number that matters is how
  // many parts it produces, not the size itself.
  it('shows the resulting part count while the size is being typed', async () => {
    const view = await openSplit()
    await pickFile(view)
    await typeSize(view.stdin, '5')
    expect((view.lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('3 parts, last one 2')
  })

  it('passes the file and size through and reports where it wrote', async () => {
    const calls: SplitOptions[] = []
    const commands = fakeCommands({
      splitPo: vi.fn(async (opts: SplitOptions) => {
        calls.push(opts)
        return {
          file: opts.file,
          dir: join(cwd, 'plugin-tr-split'),
          entries: 12,
          size: opts.size,
          parts: [
            { file: 'a', entries: 5 },
            { file: 'b', entries: 5 },
            { file: 'c', entries: 2 },
          ],
          leftBehind: [],
        }
      }),
    })
    const view = await openSplit(commands)
    await pickFile(view)
    await typeSize(view.stdin, '5')
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, 'Wrote')

    expect(calls).toEqual([{ file: join(cwd, 'plugin-tr.po'), size: 5 }])
    const frame = (view.lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(frame).toContain('12 entries into 3 parts')
    expect(frame).toContain('plugin-tr-split')
  })

  // The guard is the whole safety story for this command, so its refusal has to
  // reach the screen rather than leaving the run looking finished.
  it('shows why a refused split was refused', async () => {
    const commands = fakeCommands({
      splitPo: vi.fn(async () => {
        throw new Error('plugin-tr-split already has 3 file(s) in it')
      }),
    })
    const view = await openSplit(commands)
    await pickFile(view)
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, 'Split failed')
    expect((view.lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('already has 3 file(s)')
  })
})
