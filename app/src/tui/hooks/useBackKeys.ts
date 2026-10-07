import { useInput } from 'ink'

export interface BackKeysOptions {
  enabled?: boolean
  allowQ?: boolean
  onEnter?: () => void
}

// Stays subscribed even when disabled: Ink only reads stdin (and so only sees Ctrl+C)
// while some useInput is active, and a screen mid-run must still be interruptible.
export function useBackKeys(onBack: () => void, { enabled = true, allowQ = true, onEnter }: BackKeysOptions = {}): void {
  useInput((input, key) => {
    if (!enabled) return
    if (key.escape || (allowQ && input === 'q' && !key.ctrl && !key.meta)) {
      onBack()
      return
    }
    if (key.return && onEnter) onEnter()
  })
}
