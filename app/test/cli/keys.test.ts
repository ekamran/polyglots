import { describe, expect, it, vi } from 'vitest'
import { watchKeys } from '../../src/cli/keys.js'
import { createRunControl } from '../../src/run-control.js'

function fakeStdin(isTTY: boolean) {
  const listeners = new Set<(chunk: string) => void>()
  return {
    isTTY,
    raw: [] as boolean[],
    resumed: 0,
    paused: 0,
    setRawMode(mode: boolean) {
      this.raw.push(mode)
    },
    on(_event: 'data', listener: (chunk: string) => void) {
      listeners.add(listener)
    },
    off(_event: 'data', listener: (chunk: string) => void) {
      listeners.delete(listener)
    },
    resume() {
      this.resumed += 1
    },
    pause() {
      this.paused += 1
    },
    press(key: string) {
      for (const listener of listeners) listener(key)
    },
    get listening() {
      return listeners.size
    },
  }
}

describe('watchKeys', () => {
  const noInterrupt = { onInterrupt: () => {} }

  it('pauses, resumes and stops on the keys it documents', () => {
    const stdin = fakeStdin(true)
    const control = createRunControl()
    watchKeys(stdin, control, noInterrupt)

    stdin.press('p')
    expect(control.state).toBe('paused')
    stdin.press('r')
    expect(control.state).toBe('running')
    stdin.press('q')
    expect(control.state).toBe('stopping')
  })

  it('ignores keys it does not know', () => {
    const stdin = fakeStdin(true)
    const control = createRunControl()
    watchKeys(stdin, control, noInterrupt)

    stdin.press('x')
    expect(control.state).toBe('running')
  })

  // Raw mode swallows the signal, so without this a long run could not be killed.
  it('hands Ctrl+C back rather than eating it', () => {
    const stdin = fakeStdin(true)
    const onInterrupt = vi.fn()
    watchKeys(stdin, createRunControl(), { onInterrupt })

    stdin.press('\x03')
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  // A piped or scheduled run has nobody at the keyboard, and forcing raw mode on
  // a pipe breaks it.
  it('does nothing at all when stdin is not a terminal', () => {
    const stdin = fakeStdin(false)
    const stop = watchKeys(stdin, createRunControl(), noInterrupt)

    expect(stdin.raw).toEqual([])
    expect(stdin.listening).toBe(0)
    stop()
    expect(stdin.raw).toEqual([])
  })

  it('puts the terminal back when the run ends', () => {
    const stdin = fakeStdin(true)
    const stop = watchKeys(stdin, createRunControl(), noInterrupt)

    expect(stdin.raw).toEqual([true])
    stop()
    expect(stdin.raw).toEqual([true, false])
    expect(stdin.listening).toBe(0)
  })

  // The run's cleanup and a signal handler both reach for this, and leaving a
  // terminal in raw mode outlives the process.
  it('can be told to restore twice without undoing itself', () => {
    const stdin = fakeStdin(true)
    const stop = watchKeys(stdin, createRunControl(), noInterrupt)

    stop()
    stop()
    expect(stdin.raw).toEqual([true, false])
  })
})
