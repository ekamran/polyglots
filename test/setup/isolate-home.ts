import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

// Every test gets its own POLYGLOTS_HOME, because everything that resolves a
// path reads the variable fresh on each call.
//
// Two things go wrong without this, and only one of them is about tests. A
// test that never sets the variable reads and writes the developer's own
// config and databases, including a translation memory built up over months.
// And because the job store is keyed by content rather than by run, two tests
// sharing a fixture share a cache entry: the second one is served the first
// one's verdict and never calls its own adjudicator, so it passes while
// testing nothing.
//
// A test that wants a specific home still sets it in its own hook, which runs
// after this one.
let home: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'polyglots-test-'))
  process.env.POLYGLOTS_HOME = home
})

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true })
  home = undefined
})
