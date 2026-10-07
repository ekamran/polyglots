// The TUI's side of the stats server, which the stats workstream (#12) owns
// in src/stats/server.ts. The shape below is the contract it published:
// binds 127.0.0.1 on a free port, never writes to the terminal, and close()
// is idempotent and drops keep-alive connections so a quit cannot hang.
//
// Loaded by a specifier the compiler cannot follow, because the two land on
// main in separate branches and this one must build and test without the
// other. Once both are merged, this can become a plain import and these
// types can be replaced by the module's own.

export interface StatsServerHandle {
  url: string
  port: number
  close(): Promise<void>
}

export interface StatsServerOptions {
  onError?: (err: Error) => void
}

export type StartStatsServer = (opts?: StatsServerOptions) => Promise<StatsServerHandle>

interface StatsServerModule {
  startStatsServer: StartStatsServer
  openInBrowser: (url: string) => Promise<boolean>
}

const SERVER_MODULE = '../stats/server.js'

async function load(): Promise<StatsServerModule> {
  try {
    return (await import(SERVER_MODULE)) as StatsServerModule
  } catch (err) {
    throw new Error(`The stats server is not available in this build: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const startStatsServer: StartStatsServer = async (opts) => (await load()).startStatsServer(opts)

/** False rather than a throw when there is no browser to open, over SSH for one: the screen then shows the URL to copy. */
export async function openInBrowser(url: string): Promise<boolean> {
  try {
    return await (await load()).openInBrowser(url)
  } catch {
    return false
  }
}
