import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { configFile } from '../../src/paths.js'
import { saveConfig } from '../../src/config.js'
import { buildUsagePayload } from '../../src/usage/payload.js'
import { DEFAULT_USAGE_URL, doNotTrack, readUsageState, sendUsageInBackground, usageStateFile, usageUrl } from '../../src/usage/index.js'

const DAY = 86_400_000

interface Endpoint {
  url: string
  bodies: unknown[]
  hits: number
  server: Server
}

async function endpoint(answer: (req: IncomingMessage, res: ServerResponse) => void = (_q, res) => res.writeHead(204).end()): Promise<Endpoint> {
  const ep: Endpoint = { url: '', bodies: [], hits: 0, server: createServer() }
  ep.server.on('request', (req, res) => {
    ep.hits += 1
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => {
      try {
        ep.bodies.push(JSON.parse(raw))
      } catch {
        ep.bodies.push(raw)
      }
      answer(req, res)
    })
  })
  await new Promise<void>((resolve) => ep.server.listen(0, '127.0.0.1', resolve))
  ep.url = `http://127.0.0.1:${(ep.server.address() as AddressInfo).port}/polyglots/api/usage`
  return ep
}

let ep: Endpoint | undefined

afterEach(async () => {
  if (ep) {
    ep.server.closeAllConnections()
    await new Promise<void>((resolve) => ep!.server.close(() => resolve()))
  }
  ep = undefined
})

const send = (extra: Partial<Parameters<typeof sendUsageInBackground>[0]> = {}) =>
  sendUsageInBackground({ env: { POLYGLOTS_USAGE_URL: ep!.url }, version: '9.9.9', ...extra })

describe('off means off', () => {
  beforeEach(async () => {
    ep = await endpoint()
  })

  it('sends nothing and creates no install id when no answer is recorded', async () => {
    expect(await send()).toBe('off')
    expect(ep!.hits).toBe(0)
    expect(existsSync(usageStateFile())).toBe(false)
  })

  it('sends nothing and creates no install id when the setting is off', async () => {
    saveConfig({ usageStats: false })
    expect(await send()).toBe('off')
    expect(ep!.hits).toBe(0)
    expect(existsSync(usageStateFile())).toBe(false)
  })

  it('sends nothing and creates no install id under DO_NOT_TRACK=1, whatever the setting says', async () => {
    saveConfig({ usageStats: true })
    expect(await send({ env: { POLYGLOTS_USAGE_URL: ep!.url, DO_NOT_TRACK: '1' } })).toBe('off')
    expect(ep!.hits).toBe(0)
    expect(existsSync(usageStateFile())).toBe(false)
  })

  it('reads DO_NOT_TRACK the way the convention means it', () => {
    expect(doNotTrack({ DO_NOT_TRACK: '1' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: 'true' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: 'yes' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: '0' })).toBe(false)
    expect(doNotTrack({ DO_NOT_TRACK: 'false' })).toBe(false)
    expect(doNotTrack({ DO_NOT_TRACK: '' })).toBe(false)
    expect(doNotTrack({})).toBe(false)
  })
})

describe('sending', () => {
  it('posts exactly the payload usage-stats show prints, and remembers the send', async () => {
    ep = await endpoint()
    saveConfig({ usageStats: true })
    expect(await send({ now: () => 1_000_000 })).toBe('sent')
    const state = readUsageState()!
    expect(state.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(state.lastSentAt).toBe(1_000_000)
    expect(ep.bodies).toEqual([buildUsagePayload({ installId: state.installId, version: '9.9.9' })])
  })

  it('sends at most once a week', async () => {
    ep = await endpoint()
    saveConfig({ usageStats: true })
    let now = 10 * DAY
    expect(await send({ now: () => now })).toBe('sent')
    now += 6 * DAY
    expect(await send({ now: () => now })).toBe('not-due')
    now += 1 * DAY
    expect(await send({ now: () => now })).toBe('sent')
    expect(ep.hits).toBe(2)
  })

  it('drops a failure and does not try again for a day', async () => {
    ep = await endpoint((_q, res) => res.writeHead(500).end())
    saveConfig({ usageStats: true })
    let now = 10 * DAY
    expect(await send({ now: () => now })).toBe('failed')
    expect(readUsageState()!.lastSentAt).toBeUndefined()
    now += DAY - 1
    expect(await send({ now: () => now })).toBe('not-due')
    now += 1
    expect(await send({ now: () => now })).toBe('failed')
    expect(ep.hits).toBe(2)
  })

  it('takes a 429 as sent: the server already holds this week', async () => {
    ep = await endpoint((_q, res) => res.writeHead(429).end())
    saveConfig({ usageStats: true })
    expect(await send({ now: () => 5 })).toBe('sent')
    expect(readUsageState()!.lastSentAt).toBe(5)
  })

  it('gives up on an endpoint that never answers, after the timeout', async () => {
    ep = await endpoint(() => undefined)
    saveConfig({ usageStats: true })
    const started = Date.now()
    expect(await send({ timeoutMs: 200 })).toBe('failed')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('never throws, even over a config file it cannot parse', async () => {
    ep = await endpoint()
    mkdirSync(dirname(configFile()), { recursive: true })
    writeFileSync(configFile(), '{ not json')
    expect(await send()).toBe('off')
  })
})

describe('the endpoint URL', () => {
  it('defaults to the site, and the environment overrides it', () => {
    expect(DEFAULT_USAGE_URL).toBe('https://ada.tools/polyglots/api/usage')
    expect(usageUrl({})).toBe(DEFAULT_USAGE_URL)
    expect(usageUrl({ POLYGLOTS_USAGE_URL: 'http://127.0.0.1:1/x' })).toBe('http://127.0.0.1:1/x')
  })

  it('is pointed away from the network for every test', () => {
    // test/setup/isolate-home.ts sets it, so a test that opts in by accident
    // can never reach ada.tools.
    expect(usageUrl(process.env)).not.toBe(DEFAULT_USAGE_URL)
    expect(new URL(usageUrl(process.env)).hostname).toBe('127.0.0.1')
  })
})

describe('a command exits on time while the endpoint hangs', () => {
  it('does not hold the process open for the request', async () => {
    let arrived = 0
    ep = await endpoint(() => undefined)
    ep.server.on('request', () => (arrived = Date.now()))
    saveConfig({ usageStats: true })
    const require = createRequire(import.meta.url)
    const tsx = require.resolve('tsx')
    const script = fileURLToPath(new URL('./fixtures/send-then-exit.ts', import.meta.url))
    const child = spawn(process.execPath, ['--import', tsx, script], {
      env: { ...process.env, POLYGLOTS_USAGE_URL: ep.url },
      stdio: 'ignore',
    })
    const exited = await new Promise<number>((resolve) => child.on('exit', () => resolve(Date.now())))
    // The request did go out, so this proves the process did not wait for it,
    // rather than that nothing was sent. The client's own timeout is seconds.
    expect(arrived).toBeGreaterThan(0)
    expect(exited - arrived).toBeLessThan(1000)
    expect(readFileSync(usageStateFile(), 'utf8')).toContain('lastAttemptAt')
  })
})
