import { createContext, useContext } from 'react'

export interface Activity {
  readonly busy: boolean
  begin(): () => void
}

export function createActivity(): Activity {
  let running = 0
  return {
    get busy() {
      return running > 0
    },
    begin() {
      running++
      let released = false
      return () => {
        if (released) return
        released = true
        running--
      }
    },
  }
}

const ActivityContext = createContext<Activity>(createActivity())

export const ActivityProvider = ActivityContext.Provider

export function useActivity(): Activity {
  return useContext(ActivityContext)
}
