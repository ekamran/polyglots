import { describe, expect, it, vi } from 'vitest'
import { clipboardCommands, copyToClipboard } from '../../src/tui/clipboard.js'

describe('clipboardCommands', () => {
  it('uses pbcopy on macOS', () => {
    expect(clipboardCommands('darwin')).toEqual([{ command: 'pbcopy', args: [] }])
  })

  it('uses clip on Windows', () => {
    expect(clipboardCommands('win32')).toEqual([{ command: 'clip', args: [] }])
  })

  // Wayland leads: where wl-copy exists the session is Wayland, and xclip may
  // still be installed but writing to a clipboard nothing there reads.
  it('tries Wayland before X on everything else', () => {
    expect(clipboardCommands('linux').map((c) => c.command)).toEqual(['wl-copy', 'xclip', 'xsel'])
  })
})

describe('copyToClipboard', () => {
  it('reports success and stops at the first helper that works', () => {
    const run = vi.fn(() => true)
    expect(copyToClipboard('hello', { platform: 'linux', run })).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('wl-copy', [], 'hello')
  })

  it('falls through to the next helper when one is missing', () => {
    const run = vi.fn((command: string) => command === 'xclip')
    expect(copyToClipboard('hello', { platform: 'linux', run })).toBe(true)
    expect(run.mock.calls.map((c) => c[0])).toEqual(['wl-copy', 'xclip'])
  })

  // A failed copy must stay a reported false rather than a throw: the sentence
  // is on screen either way, and a crashed results screen would lose the run's
  // output over a clipboard.
  it('returns false rather than throwing when nothing can copy', () => {
    const run = vi.fn(() => false)
    expect(copyToClipboard('hello', { platform: 'linux', run })).toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('survives a helper that throws', () => {
    const run = vi.fn(() => {
      throw new Error('spawn failed')
    })
    expect(copyToClipboard('hello', { platform: 'darwin', run })).toBe(false)
  })
})
