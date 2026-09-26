import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranslateOptions } from '../../src/commands/translate.js'
import { runTui } from '../../src/tui/index.js'
import { FakeStdin, FakeStdout, fakeCommands, keys, makeHome, tick, waitForText, type Home } from './helpers.js'

let home: Home
let cwd: string

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  await writeFile(join(cwd, 'plugin.po'), '')
})

afterEach(async () => {
  await home.cleanup()
})

const CTRL_C = ''

function start(commands = fakeCommands()) {
  const stdin = new FakeStdin()
  const stdout = new FakeStdout()
  const exit = vi.fn()
  // patchConsole needs console.Console, which vitest's console lacks; ink-testing-library disables it the same way.
  // interactive is forced so a CI env var cannot switch Ink to write-only-at-unmount mode.
  const done = runTui({
    isTTY: true,
    stdin: stdin.asStream(),
    stdout: stdout.asStream(),
    stderr: stdout.asStream(),
    patchConsole: false,
    interactive: true,
    exit,
    commands,
    cwd,
  })
  return { stdin, stdout, exit, done, lastFrame: () => stdout.lastFrame() }
}

async function openTranslateAndStart(stdin: FakeStdin, lastFrame: () => string | undefined) {
  await waitForText(lastFrame, 'Translate a .po file')
  stdin.write(keys.enter)
  await waitForText(lastFrame, 'plugin.po')
  stdin.write(keys.down)
  await tick()
  stdin.write(keys.enter)
  await waitForText(lastFrame, /Draft engine/)
  for (let i = 0; i < 4; i++) {
    stdin.write(keys.down)
    await tick()
  }
  // A pending run starts on the keypress; only `all` asks again.
  stdin.write(keys.enter)
}

describe('runTui', () => {
  it('refuses to start without a terminal', async () => {
    await expect(runTui({ isTTY: false })).rejects.toThrow(/needs a terminal/)
  })

  it('quits cleanly with q from the menu without forcing an exit', async () => {
    const { stdin, exit, done, lastFrame } = start()
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('q')
    await done
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits with 130 when Ctrl+C interrupts a run in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const commands = fakeCommands({
      translateFile: vi.fn(async (opts: TranslateOptions) => {
        opts.onProgress?.({ type: 'start', file: opts.file, total: 4, pending: 2 })
        await gate
        const summary = { file: opts.file, total: 4, pending: 2, fromTm: 0, translated: 2, fuzzy: 0, skipped: 0 }
        return summary
      }),
    })
    const { stdin, exit, done, lastFrame } = start(commands)
    await openTranslateAndStart(stdin, lastFrame)
    await waitForText(lastFrame, /0\/2/)

    stdin.write(CTRL_C)
    await done
    expect(exit).toHaveBeenCalledWith(130)
    release()
  })

  it('does not force an exit on Ctrl+C once the run has finished', async () => {
    const { stdin, exit, done, lastFrame } = start()
    await openTranslateAndStart(stdin, lastFrame)
    await waitForText(lastFrame, /Done\./)

    stdin.write(CTRL_C)
    await done
    expect(exit).not.toHaveBeenCalled()
  })
})
