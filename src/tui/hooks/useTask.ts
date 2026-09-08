import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../commands.js'
import { useActivity } from './activity.js'

export type TaskState<T> =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: T }
  | { status: 'error'; message: string }

export interface Task<T> {
  state: TaskState<T>
  run(fn: () => Promise<T>): void
  reset(): void
}

export function useTask<T>(): Task<T> {
  const activity = useActivity()
  const [state, setState] = useState<TaskState<T>>({ status: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    (fn: () => Promise<T>) => {
      setState({ status: 'running' })
      // Released only when the promise settles, not on unmount: the work is still
      // running after Ctrl+C unmounts the UI, and runTui needs to know that.
      const release = activity.begin()
      fn().then(
        (result) => {
          release()
          if (mounted.current) setState({ status: 'done', result })
        },
        (err: unknown) => {
          release()
          if (mounted.current) setState({ status: 'error', message: errorMessage(err) })
        },
      )
    },
    [activity],
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  return { state, run, reset }
}
