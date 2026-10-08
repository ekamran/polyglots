import type { RunControl } from '../run-control.js'

export interface KeyStream {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => void
  on: (event: 'data', listener: (chunk: Buffer | string) => void) => void
  off: (event: 'data', listener: (chunk: Buffer | string) => void) => void
  resume?: () => void
  pause?: () => void
}

export interface WatchKeysOptions {
  // Called when the user asks to kill the run outright. Raw mode swallows the
  // signal, so Ctrl+C has to be recognised by hand and handed back, or a long
  // run becomes impossible to abort.
  onInterrupt: () => void
}

const CTRL_C = '\x03'

// Reads single keys while a long run is going, and returns a function that puts
// the terminal back. Only ever on a real terminal: a piped or scheduled run has
// nobody to press anything, and forcing raw mode on a pipe breaks it.
export function watchKeys(stdin: KeyStream, control: RunControl, opts: WatchKeysOptions): () => void {
  if (stdin.isTTY !== true || typeof stdin.setRawMode !== 'function') return () => {}

  const onData = (chunk: Buffer | string): void => {
    const key = chunk.toString()
    if (key === CTRL_C) {
      opts.onInterrupt()
      return
    }
    if (key === 'p') control.pause()
    else if (key === 'r') control.resume()
    else if (key === 'q') control.stop()
  }

  stdin.setRawMode(true)
  stdin.resume?.()
  stdin.on('data', onData)

  let restored = false
  return () => {
    // Idempotent: the run's finally and a signal handler can both reach for it,
    // and leaving a terminal in raw mode is the kind of mess that outlives the
    // process.
    if (restored) return
    restored = true
    stdin.off('data', onData)
    stdin.setRawMode?.(false)
    stdin.pause?.()
  }
}
