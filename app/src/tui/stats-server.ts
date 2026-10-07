// The TUI's side of the stats server, which lives in src/stats/server.ts.
// It binds 127.0.0.1 on a free port, never writes to the terminal, and its
// close() is idempotent and drops keep-alive connections so a quit cannot
// hang. The names below are the ones the TUI was written against.

import { openInBrowser as open, startStatsServer as start, type StatsServer, type StatsServerOptions } from '../stats/server.js'

export type StatsServerHandle = StatsServer
export type { StatsServerOptions }
export type StartStatsServer = (opts?: StatsServerOptions) => Promise<StatsServerHandle>

export const startStatsServer: StartStatsServer = start

/** False rather than a throw when there is no browser to open, over SSH for one: the screen then shows the URL to copy. */
export async function openInBrowser(url: string): Promise<boolean> {
  try {
    return await open(url)
  } catch {
    return false
  }
}
