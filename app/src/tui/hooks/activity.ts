import { createContext, useContext, useEffect, useState } from 'react'

export interface Activity {
  readonly busy: boolean
  begin(): () => void
  // For the footer's run indicator and the quit prompt. runTui reads `busy`
  // once after the UI is gone and needs no subscription.
  subscribe(listener: (busy: boolean) => void): () => void
}

export function createActivity(): Activity {
  let running = 0
  const listeners = new Set<(busy: boolean) => void>()
  const notify = () => {
    for (const listener of listeners) listener(running > 0)
  }
  return {
    get busy() {
      return running > 0
    },
    begin() {
      running++
      notify()
      let released = false
      return () => {
        if (released) return
        released = true
        running--
        notify()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const ActivityContext = createContext<Activity>(createActivity())

export const ActivityProvider = ActivityContext.Provider

export function useActivity(): Activity {
  return useContext(ActivityContext)
}

export function useBusy(): boolean {
  const activity = useActivity()
  const [busy, setBusy] = useState(activity.busy)
  useEffect(() => {
    setBusy(activity.busy)
    return activity.subscribe(setBusy)
  }, [activity])
  return busy
}
