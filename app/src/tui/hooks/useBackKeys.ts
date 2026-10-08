import { useKeys } from './useKeys.js'

export interface BackKeysOptions {
  enabled?: boolean
  allowQ?: boolean
}

// Esc and q only. Enter used to ride along as `onEnter`, but what it does
// differs by screen (back once done, retry after a failure), and the key
// table lists those per screen, so each screen binds its own.
//
// Stays subscribed even when disabled: Ink only reads stdin (and so only sees Ctrl+C)
// while some useInput is active, and a screen mid-run must still be interruptible.
export function useBackKeys(onBack: () => void, { enabled = true, allowQ = true }: BackKeysOptions = {}): void {
  useKeys({ back: { esc: enabled ? onBack : undefined, q: enabled && allowQ ? onBack : undefined } })
}
