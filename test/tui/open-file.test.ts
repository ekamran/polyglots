import { describe, expect, it, vi } from 'vitest'
import { openCommand, openInDefaultApp } from '../../src/tui/open-file.js'

describe('openCommand', () => {
  it('uses open on macOS', () => {
    expect(openCommand('darwin')).toEqual({ command: 'open', args: [] })
  })

  // start is a cmd builtin, not a program, and its first quoted argument is the
  // window title. Omitting the empty title makes Windows treat the file path as
  // the title and open nothing.
  it('goes through cmd on Windows, with an empty window title', () => {
    expect(openCommand('win32')).toEqual({ command: 'cmd', args: ['/c', 'start', ''] })
  })

  it('uses xdg-open on everything else', () => {
    expect(openCommand('linux')).toEqual({ command: 'xdg-open', args: [] })
  })
})

describe('openInDefaultApp', () => {
  it('passes the path after the launcher own arguments', () => {
    const launch = vi.fn(() => true)
    expect(openInDefaultApp('/tmp/a-tr.po', { platform: 'win32', launch })).toBe(true)
    expect(launch).toHaveBeenCalledWith('cmd', ['/c', 'start', '', '/tmp/a-tr.po'])
  })

  it('hands macOS the path alone', () => {
    const launch = vi.fn(() => true)
    openInDefaultApp('/tmp/a-tr.po', { platform: 'darwin', launch })
    expect(launch).toHaveBeenCalledWith('open', ['/tmp/a-tr.po'])
  })

  // The results screen is still showing the path, so a launcher that is missing
  // costs the reader a copy and paste, not the run's output.
  it('reports false rather than throwing when the launcher is missing', () => {
    const launch = vi.fn(() => {
      throw new Error('spawn xdg-open ENOENT')
    })
    expect(openInDefaultApp('/tmp/a-tr.po', { platform: 'linux', launch })).toBe(false)
  })
})
