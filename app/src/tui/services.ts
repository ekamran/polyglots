import { createContext, useContext, useEffect, useState } from 'react'
import type { StatsServerHandle } from './stats-server.js'

// What outlives the screen that started it. The stats server keeps serving
// after its screen is left, so the browser tab stays live while the person
// does other things, and runTui closes it when the app ends; the last output
// path is printed after the alternate screen is gone. Both are held here,
// above the screens, and runTui is handed the same object so it can reach
// them after the UI has unmounted.

export interface Services {
  readonly stats: StatsServerHandle | undefined
  // Shared while starting, so a second visit to the screen during the first
  // start waits for it instead of starting another server.
  startStats(start: () => Promise<StatsServerHandle>): Promise<StatsServerHandle>
  stopStats(): Promise<void>
  // For the end of the app: also waits out a start still in flight, which
  // would otherwise finish after the close and leave a listening socket
  // keeping Node alive with no UI. Nothing starts after it.
  shutdown(): Promise<void>
  lastOutput: string | undefined
  subscribe(listener: () => void): () => void
}

export function createServices(): Services {
  let stats: StatsServerHandle | undefined
  let starting: Promise<StatsServerHandle> | undefined
  let closed = false
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }
  return {
    get stats() {
      return stats
    },
    startStats(start) {
      if (closed) return Promise.reject(new Error('The app is closing.'))
      if (stats) return Promise.resolve(stats)
      starting ??= start().then(
        (handle) => {
          stats = handle
          starting = undefined
          notify()
          return handle
        },
        (err: unknown) => {
          starting = undefined
          throw err
        },
      )
      return starting
    },
    async stopStats() {
      const handle = stats
      stats = undefined
      notify()
      await handle?.close()
    },
    async shutdown() {
      closed = true
      if (starting) await starting.catch(() => undefined)
      await this.stopStats()
    },
    lastOutput: undefined,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const ServicesContext = createContext<Services>(createServices())

export const ServicesProvider = ServicesContext.Provider

export function useServices(): Services {
  return useContext(ServicesContext)
}

/** The stats URL while the server is up, re-rendering when it starts or stops. */
export function useStatsUrl(): string | undefined {
  const services = useServices()
  const [url, setUrl] = useState(services.stats?.url)
  useEffect(() => {
    setUrl(services.stats?.url)
    return services.subscribe(() => setUrl(services.stats?.url))
  }, [services])
  return url
}

/**
 * Closes the stats server, giving up after `ms`. A browser holding a
 * connection open must not be able to hold the terminal hostage on quit; the
 * contract says close() drops such connections, and this is the belt to that
 * pair of braces.
 */
export async function closeServices(services: Services, ms = 2000): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    services.shutdown().catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
      timer.unref()
    }),
  ])
  clearTimeout(timer)
}
