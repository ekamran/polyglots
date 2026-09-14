export type RunState = 'running' | 'paused' | 'stopping'

// What a batch loop should do when it reaches a boundary.
export type Gate = 'go' | 'stop'

export interface RunControl {
  readonly state: RunState
  pause(): void
  resume(): void
  stop(): void
  // Awaited at a batch boundary, never inside one. A paused run therefore always
  // finishes the batch it is in, and whatever that batch decided is persisted by
  // the normal path before anything parks.
  gate(): Promise<Gate>
  subscribe(listener: (state: RunState) => void): () => void
}

export function createRunControl(): RunControl {
  let state: RunState = 'running'
  let release: (() => void) | undefined
  const listeners = new Set<(state: RunState) => void>()

  const set = (next: RunState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
    // Anything that is not a pause frees a gate that is already waiting.
    if (next !== 'paused') {
      release?.()
      release = undefined
    }
  }

  return {
    get state() {
      return state
    },
    // A stopping run is on its way out, so a late keypress must not park it.
    pause: () => set(state === 'running' ? 'paused' : state),
    resume: () => set(state === 'paused' ? 'running' : state),
    stop: () => set('stopping'),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async gate() {
      // A loop rather than a single await: a resume followed by another pause
      // before the loop gets its turn must park again, not fall through.
      while (state === 'paused') {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return state === 'stopping' ? 'stop' : 'go'
    },
  }
}
