#!/usr/bin/env node
// Refuses to build while a review or translate is in flight.
//
// A running job spawns a fresh MCP server from dist/ for every batch, so
// rewriting dist/ underneath it can hand a half-written file to the next spawn.
// This happened: a build landed two minutes into a seven-thousand-entry run.
//
// Fails OPEN. Anything that stops this check from answering — no database, a
// native module that has not been built yet, a schema older than the pid
// column — allows the build. A guard that can block a legitimate build on its
// own malfunction is worse than the hazard it guards against, and `prepare`
// runs during `npm install`, when better-sqlite3 may not be usable yet.

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ESCAPE_HATCH = 'POLYGLOTS_ALLOW_BUILD'

function jobsDbPath() {
  const root = process.env.POLYGLOTS_HOME
  return root && root.length > 0
    ? join(root, 'data', 'jobs.db')
    : join(homedir(), '.local', 'share', 'polyglots', 'jobs.db')
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function liveRuns() {
  const path = jobsDbPath()
  if (!existsSync(path)) return []
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const columns = db.pragma('table_info(run)').map((c) => c.name)
    // Older databases have no pid, so nothing here can tell a live run from a
    // row a kill left behind. Say nothing rather than guess.
    if (!columns.includes('pid')) return []
    return db
      .prepare(`SELECT id, command, file, pid, started_at FROM run WHERE state = 'running'`)
      .all()
      .filter((r) => r.pid !== null && alive(r.pid))
  } finally {
    db.close()
  }
}

if (process.env[ESCAPE_HATCH] === '1') process.exit(0)

let running
try {
  running = liveRuns()
} catch {
  // Could not check. Allow the build; see the note at the top.
  process.exit(0)
}

if (running.length === 0) process.exit(0)

const plural = running.length === 1 ? 'run is' : 'runs are'
console.error(`\nRefusing to build: ${running.length} polyglots ${plural} in flight.\n`)
for (const r of running) {
  const mins = Math.round((Date.now() - r.started_at) / 60000)
  console.error(`  pid ${r.pid}  ${r.command}  ${r.file}  (${mins}m)`)
}
console.error(
  `\nA running job spawns an MCP server from dist/ for every batch, so rebuilding
now can break it. Wait for it to finish, or stop it with q and re-run it
afterwards — it will pick up from its cache.

To build anyway: ${ESCAPE_HATCH}=1 npm run build\n`,
)
process.exit(1)
