import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { configDir, configFile, dataDir, dbFile, jobsDbFile, secretsFile } from '../../src/paths.js'

describe('paths', () => {
  let home: string
  const original = process.env.POLYGLOTS_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-paths-'))
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = original
    await rm(home, { recursive: true, force: true })
  })

  it('honors POLYGLOTS_HOME for every path', () => {
    process.env.POLYGLOTS_HOME = home
    expect(configDir().startsWith(home + sep)).toBe(true)
    expect(dataDir().startsWith(home + sep)).toBe(true)
    expect(configFile()).toBe(join(configDir(), 'config.json'))
    expect(secretsFile()).toBe(join(configDir(), '.env'))
    expect(dbFile()).toBe(join(dataDir(), 'polyglots.db'))
    expect(jobsDbFile()).toBe(join(dataDir(), 'jobs.db'))
    // Separate files on purpose: one holds the translation memory, the other
    // is disposable run state. A shared file would let a schema change to the
    // second corrupt the first.
    expect(jobsDbFile()).not.toBe(dbFile())
    expect(configDir()).not.toBe(dataDir())
  })

  it('falls back to XDG-style defaults under the home directory', () => {
    delete process.env.POLYGLOTS_HOME
    expect(configDir()).toBe(join(homedir(), '.config', 'polyglots'))
    expect(dataDir()).toBe(join(homedir(), '.local', 'share', 'polyglots'))
    expect(dbFile()).toBe(join(homedir(), '.local', 'share', 'polyglots', 'polyglots.db'))
    expect(jobsDbFile()).toBe(join(homedir(), '.local', 'share', 'polyglots', 'jobs.db'))
  })

  it('treats an empty POLYGLOTS_HOME as unset', () => {
    process.env.POLYGLOTS_HOME = ''
    expect(configDir()).toBe(join(homedir(), '.config', 'polyglots'))
  })
})
