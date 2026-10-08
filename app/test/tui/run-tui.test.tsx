import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranslateOptions } from '../../src/commands/translate.js'
import { runTui, type RunTuiOptions } from '../../src/tui/index.js'
import { defaultCommands } from '../../src/tui/commands.js'
import { openJobsDb } from '../../src/jobs/db.js'
import { getRun, startRun } from '../../src/jobs/runs.js'
import { jobsDbFile } from '../../src/paths.js'
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

  // The error path closes the server too, and a close that hangs there
  // would keep Node alive behind the printed error just the same.
  it('exits non-zero after a render crash when closing the stats server hangs', async () => {
    let calls = 0
    const state = memoryTuiState()
    const commands = fakeCommands({
      startStatsServer: vi.fn(async () => ({ url: 'http://127.0.0.1:9/x/', port: 9, close: () => new Promise<void>(() => {}) })),
      // The shell reads it once at launch; Interface settings reads it again
      // on opening, which is where this crash is planted.
      loadTuiState: () => {
        calls++
        if (calls > 1) throw new Error('settings exploded')
        return state.loadTuiState()
      },
    })
    const { stdin, stdout, exit, done, lastFrame } = start(commands, { closeTimeoutMs: 20 })
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('s')
    await waitForText(lastFrame, 'Serving at')
    stdin.write('q')
    await waitForText(lastFrame, 'Translate a .po file')
    stdin.write('c')
    await waitForText(lastFrame, 'Interface settings')
    stdin.write('i')
    await expect(done).rejects.toThrow('settings exploded')
    expect(exit).toHaveBeenCalledWith(1)
    expect(stdout.frames.join('')).toContain('settings exploded')
  })

  // On a pipe the write is asynchronous, and exiting before it drains cuts
  // the one line the summary exists to leave behind.
  it('lets the last-output line drain before exiting on a hung close', async () => {
    const commands = fakeCommands({
      startStatsServer: vi.fn(async () => ({ url: 'http://127.0.0.1:9/x/', port: 9, close: () => new Promise<void>(() => {}) })),
    })
    const { stdin, stdout, exit, done, lastFrame } = start(commands, { closeTimeoutMs: 20 })
    stdout.flushDelayMs = 30
    let flushedAtExit: string[] = []
    exit.mockImplementation(() => {
      flushedAtExit = [...stdout.flushed]
    })
    await openTranslateAndStart(stdin, lastFrame)
    await waitForText(lastFrame, /Done\./)
    stdin.write('q')
    await waitForText(lastFrame, 'About')
    stdin.write('s')
    await waitForText(lastFrame, 'Serving at')
    stdin.write('q')
    await waitForText(lastFrame, 'About')
    stdin.write('q')
    await done
    expect(exit).toHaveBeenCalledWith(0)
    expect(flushedAtExit.some((c) => c.startsWith('Last output:'))).toBe(true)
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

  // End to end against a jobs.db in the test's own home: the run row is
  // written the way the real translate writes it, under this process's pid,
  // and the real stopOwnRuns ends it.
  describe.each([
    ['y at the quit prompt', 'y'],
    ['a second Ctrl+C', CTRL_C],
  ])('quitting a run with %s', (_name, answer) => {
    it('leaves the run recorded as stopped, not abandoned', async () => {
      expect(jobsDbFile().startsWith(home.path)).toBe(true)
      let runId!: number
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const commands = fakeCommands({
        translateFile: vi.fn(async (opts: TranslateOptions) => {
          const db = openJobsDb()
          runId = startRun(db, { file: opts.file, command: 'translate', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'deepl' })
          db.close()
          opts.onProgress?.({ type: 'start', file: opts.file, total: 4, pending: 2 })
          await gate
          return { file: opts.file, total: 4, pending: 2, fromTm: 0, translated: 2, fuzzy: 0, skipped: 0 }
        }),
        stopOwnRuns: defaultCommands.stopOwnRuns,
      })
      const { stdin, exit, done, lastFrame } = start(commands)
      await openTranslateAndStart(stdin, lastFrame)
      await waitForText(lastFrame, /0\/2/)
      stdin.write(CTRL_C)
      await waitForText(lastFrame, 'A run is still going')
      stdin.write(answer)
      await done
      expect(exit).toHaveBeenCalledWith(130)
      const db = openJobsDb()
      const row = getRun(db, runId)!
      db.close()
      expect(row.state).toBe('stopped')
      expect(row.ending).toBe('stopped')
      release()
    })
  })

  it('records a quit during a run as stopped before exiting', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const order: string[] = []
    const commands = fakeCommands({
      translateFile: vi.fn(async (opts: TranslateOptions) => {
        opts.onProgress?.({ type: 'start', file: opts.file, total: 4, pending: 2 })
        await gate
        return { file: opts.file, total: 4, pending: 2, fromTm: 0, translated: 2, fuzzy: 0, skipped: 0 }
      }),
      stopOwnRuns: vi.fn(() => {
        order.push('stop')
        return 1
      }),
    })
    const { stdin, exit, done, lastFrame } = start(commands)
    exit.mockImplementation(() => void order.push('exit'))
    await openTranslateAndStart(stdin, lastFrame)
    await waitForText(lastFrame, /0\/2/)
    stdin.write(CTRL_C)
    await waitForText(lastFrame, 'A run is still going')
    stdin.write('y')
    await done
    expect(order).toEqual(['stop', 'exit'])
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
