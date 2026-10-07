import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranslateOptions } from '../../src/commands/translate.js'
import { runTui, type RunTuiOptions } from '../../src/tui/index.js'
import { createActivity } from '../../src/tui/hooks/activity.js'
import { DEFAULT_TUI_STATE } from '../../src/tui/state.js'
import { FakeStdin, FakeStdout, fakeCommands, keys, makeHome, memoryTuiState, tick, waitForText, type Home } from './helpers.js'

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

function start(commands = fakeCommands(), extra: Partial<RunTuiOptions> = {}) {
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
    ...extra,
  })
  return { stdin, stdout, exit, done, lastFrame: () => stdout.lastFrame() }
}

async function openTranslateAndStart(stdin: FakeStdin, lastFrame: () => string | undefined) {
  await waitForText(lastFrame, 'Translate a .po file')
  stdin.write('t')
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

  it('draws on the alternate screen and gives the terminal back on quit', async () => {
    const { stdin, stdout, done, lastFrame } = start()
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('q')
    await done
    const all = stdout.frames.join('')
    expect(all).toContain('\u001b[?1049h')
    expect(all.lastIndexOf('\u001b[?1049l')).toBeGreaterThan(all.indexOf('\u001b[?1049h'))
  })

  // Ink treats output written while it tears the alternate screen down as
  // disposable, so a crash has to come back out of runTui to be seen at all.
  // Ink's own error boundary does the exiting; this holds runTui to passing
  // the error on with the terminal already given back.
  it('restores the terminal and rethrows when rendering fails', async () => {
    const commands = fakeCommands({
      loadTuiState: () => {
        throw new Error('render blew up')
      },
    })
    const { stdout, done } = start(commands)
    await expect(done).rejects.toThrow('render blew up')
    expect(stdout.frames.join('')).toContain('\u001b[?1049l')
  })

  it('exits hard after a render crash while a run is in flight, with the trace', async () => {
    const activity = createActivity()
    activity.begin()
    const commands = fakeCommands({
      loadTuiState: () => {
        throw new Error('render blew up')
      },
    })
    const { stdout, exit, done } = start(commands, { activity })
    await expect(done).rejects.toThrow('render blew up')
    expect(exit).toHaveBeenCalledWith(130)
    expect(stdout.frames.join('')).toMatch(/render blew up[\s\S]*abandoning the run/)
  })

  // A hung close would leave the listening socket holding Node open after the
  // terminal is back, and the CLI only sets an exit code.
  it('exits when closing the stats server hangs', async () => {
    const commands = fakeCommands({
      startStatsServer: vi.fn(async () => ({ url: 'http://127.0.0.1:9/x/', port: 9, close: () => new Promise<void>(() => {}) })),
    })
    const { stdin, exit, done, lastFrame } = start(commands, { closeTimeoutMs: 20 })
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('s')
    await waitForText(lastFrame, 'Serving at')
    stdin.write('q')
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('q')
    await done
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('closes the stats server when the app quits', async () => {
    const close = vi.fn(async () => {})
    const commands = fakeCommands({ startStatsServer: vi.fn(async () => ({ url: 'http://127.0.0.1:9/x/', port: 9, close })) })
    const { stdin, done, lastFrame } = start(commands)
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('s')
    await waitForText(lastFrame, 'Serving at')
    stdin.write('q')
    await waitForText(lastFrame, 'Translate a .po file')
    expect(close).not.toHaveBeenCalled()
    stdin.write('q')
    await done
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('names the last output after quitting, unless that is switched off', async () => {
    const run = async (exitSummary: boolean) => {
      const commands = fakeCommands({ ...memoryTuiState({ ...DEFAULT_TUI_STATE, wizard: { ...DEFAULT_TUI_STATE.wizard, dismissed: true }, settings: { exitSummary } }) })
      const { stdin, stdout, done, lastFrame } = start(commands)
      await openTranslateAndStart(stdin, lastFrame)
      await waitForText(lastFrame, /Done\./)
      stdin.write('q')
      await waitForText(lastFrame, 'About')
      stdin.write('q')
      await done
      return stdout.frames.join('')
    }
    const on = await run(true)
    const after = on.slice(on.lastIndexOf('\u001b[?1049l'))
    expect(after).toContain(`Last output: ${join(cwd, 'plugin.po')}`)
    const off = await run(false)
    expect(off).not.toContain('Last output:')
  })

  it('asks before Ctrl+C abandons a run, and a second Ctrl+C exits with 130', async () => {
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
    await waitForText(lastFrame, 'A run is still going')
    expect(exit).not.toHaveBeenCalled()
    stdin.write(CTRL_C)
    await done
    expect(exit).toHaveBeenCalledWith(130)
    release()
  })

  it('keeps the run going when the quit prompt is declined', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const commands = fakeCommands({
      translateFile: vi.fn(async (opts: TranslateOptions) => {
        opts.onProgress?.({ type: 'start', file: opts.file, total: 4, pending: 2 })
        await gate
        const summary = { file: opts.file, total: 4, pending: 2, fromTm: 0, translated: 2, fuzzy: 0, skipped: 0 }
        opts.onProgress?.({ type: 'done', summary })
        return summary
      }),
    })
    const { stdin, exit, done, lastFrame } = start(commands)
    await openTranslateAndStart(stdin, lastFrame)
    await waitForText(lastFrame, /0\/2/)
    stdin.write(CTRL_C)
    await waitForText(lastFrame, 'A run is still going')
    stdin.write('n')
    await waitForText(lastFrame, /0\/2/)
    release()
    await waitForText(lastFrame, /Done\./)
    stdin.write(CTRL_C)
    await done
    expect(exit).not.toHaveBeenCalled()
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
