import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { dataDir } from '../../src/paths.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import { resolveServerOptions, serverLaunch, writeMcpConfig } from '../../src/mcp/config.js'

interface McpJson {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
}

async function readEntry(path: string) {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as McpJson
  return parsed.mcpServers.polyglots!
}

describe('writeMcpConfig', () => {
  let home: string
  const original = process.env.POLYGLOTS_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-mcp-config-'))
    process.env.POLYGLOTS_HOME = home
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = original
    await rm(home, { recursive: true, force: true })
  })

  it('writes mcp.json under dataDir() and returns its absolute path', async () => {
    const path = await writeMcpConfig()
    expect(isAbsolute(path)).toBe(true)
    expect(path).toBe(join(dataDir(), 'mcp.json'))
    expect(path.startsWith(home + sep)).toBe(true)
    await access(path)
  })

  it('describes a stdio server launched with the current node binary', async () => {
    const entry = await readEntry(await writeMcpConfig())
    expect(entry.command).toBe(process.execPath)
    expect(entry.args.length).toBeGreaterThan(0)
    for (const arg of entry.args) {
      expect(isAbsolute(arg)).toBe(true)
      await access(arg)
    }
    expect(entry.args.at(-1)).toMatch(/[\\/]mcp[\\/]server\.(ts|js)$/)
  })

  it('carries POLYGLOTS_HOME and extra env into the server env', async () => {
    const entry = await readEntry(await writeMcpConfig({ env: { POLYGLOTS_DB: '/x/y.db' } }))
    expect(entry.env).toEqual({ POLYGLOTS_HOME: home, POLYGLOTS_DB: '/x/y.db' })
  })

  it('maps the locale option to a normalized POLYGLOTS_LOCALE so tool defaults follow the run locale', async () => {
    const entry = await readEntry(await writeMcpConfig({ locale: 'de_DE' }))
    expect(entry.env).toEqual({ POLYGLOTS_HOME: home, POLYGLOTS_LOCALE: 'de-de' })
  })

  it('lets a raw env entry override the locale option', async () => {
    const entry = await readEntry(await writeMcpConfig({ locale: 'de', env: { POLYGLOTS_LOCALE: 'fr' } }))
    expect(entry.env.POLYGLOTS_LOCALE).toBe('fr')
  })

  it('omits POLYGLOTS_HOME from env when it is unset', async () => {
    delete process.env.POLYGLOTS_HOME
    const entry = await readEntry(await writeMcpConfig({ dir: home }))
    expect(entry.env).toEqual({})
  })

  it('resolves a relative POLYGLOTS_HOME to absolute paths in both the return value and env', async () => {
    const rel = relative(process.cwd(), home)
    expect(isAbsolute(rel)).toBe(false)
    process.env.POLYGLOTS_HOME = rel
    const path = await writeMcpConfig()
    expect(path).toBe(join(home, 'data', 'mcp.json'))
    const entry = await readEntry(path)
    expect(entry.env.POLYGLOTS_HOME).toBe(home)
  })

  it('honors an explicit dir', async () => {
    const dir = join(home, 'elsewhere', 'nested')
    const path = await writeMcpConfig({ dir })
    expect(path).toBe(join(dir, 'mcp.json'))
    await access(path)
  })

  it('writes mcp.json readable only by the owner', async () => {
    const path = await writeMcpConfig()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await writeMcpConfig()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('serverLaunch', () => {
  it('launches the compiled server directly when running from dist', () => {
    const launch = serverLaunch('/opt/polyglots/dist/mcp/config.js')
    expect(launch).toEqual({ command: process.execPath, args: ['/opt/polyglots/dist/mcp/server.js'] })
  })

  it('launches server.ts through the tsx cli when running from source', async () => {
    const launch = serverLaunch('/repo/src/mcp/config.ts')
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toHaveLength(2)
    expect(launch.args[0]).toMatch(/[\\/]tsx[\\/]/)
    await access(launch.args[0]!)
    expect(launch.args[1]).toBe('/repo/src/mcp/server.ts')
  })
})

describe('resolveServerOptions', () => {
  it('falls back to config values when no overrides are set', () => {
    expect(resolveServerOptions({}, { ...DEFAULT_CONFIG, defaultLocale: 'sv' })).toEqual({
      locale: 'sv',
      ttlDays: DEFAULT_CONFIG.consistencyTtlDays,
      dbPath: undefined,
    })
  })

  // The server still starts: a globally registered server serves calls that
  // name their locale, and only a call that does not is refused (tools.ts).
  it('leaves the locale unset when neither the environment nor config names one', () => {
    expect(resolveServerOptions({}, DEFAULT_CONFIG)).toEqual({
      ttlDays: DEFAULT_CONFIG.consistencyTtlDays,
      dbPath: undefined,
    })
  })

  it('honors POLYGLOTS_LOCALE, POLYGLOTS_CONSISTENCY_TTL_DAYS and POLYGLOTS_DB', () => {
    expect(
      resolveServerOptions(
        { POLYGLOTS_LOCALE: 'de_DE', POLYGLOTS_CONSISTENCY_TTL_DAYS: '7', POLYGLOTS_DB: '/tmp/x.db' },
        DEFAULT_CONFIG,
      ),
    ).toEqual({ locale: 'de-de', ttlDays: 7, dbPath: '/tmp/x.db' })
  })

  it('normalizes config.defaultLocale the same way as the env override', () => {
    expect(resolveServerOptions({}, { ...DEFAULT_CONFIG, defaultLocale: 'tr_TR' }).locale).toBe('tr-tr')
    expect(resolveServerOptions({ POLYGLOTS_LOCALE: 'TR' }, { ...DEFAULT_CONFIG, defaultLocale: 'de_DE' }).locale).toBe('tr')
  })

  it('ignores blank or invalid overrides', () => {
    const config = { ...DEFAULT_CONFIG, defaultLocale: 'sv' }
    expect(resolveServerOptions({ POLYGLOTS_LOCALE: '  ', POLYGLOTS_CONSISTENCY_TTL_DAYS: 'abc', POLYGLOTS_DB: '' }, config)).toEqual({
      locale: 'sv',
      ttlDays: DEFAULT_CONFIG.consistencyTtlDays,
      dbPath: undefined,
    })
    expect(resolveServerOptions({ POLYGLOTS_CONSISTENCY_TTL_DAYS: '0' }, DEFAULT_CONFIG).ttlDays).toBe(
      DEFAULT_CONFIG.consistencyTtlDays,
    )
  })
})
