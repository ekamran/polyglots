import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { finishRun, startRun } from '../../src/jobs/runs.js'
import { jobsDbFile } from '../../src/paths.js'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isBusy, openInBrowser, startStatsServer, STATS_PORT, type StatsServer } from '../../src/stats/server.js'

let db: Database.Database
let dir: string
let server: StatsServer | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-server-'))
  db = openJobsDb(join(dir, 'jobs.db'))
})

afterEach(async () => {
  await server?.close()
  server = undefined
  if (db.open) db.close()
  await rm(dir, { recursive: true, force: true })
})

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function get(url: string, opts: { headers?: Record<string, string>; method?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method ?? 'GET', headers: opts.headers ?? {} }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

function reviewed(entries: number): void {
  const at = Date.now() - 60_000
  const id = startRun(
    db,
    { file: '/tmp/a-tr.po', project: 'Alpha', command: 'review', locale: 'tr', nplurals: 2, batchSize: 25, engine: 'claude' },
    () => at,
  )
  finishRun(db, id, { entries, flagged: 1, repaired: 0, unreviewed: 0, approvable: 0, byCategory: { ampersand: 1 } }, () => at + 1000)
}

describe('startStatsServer', () => {
  it('listens on 127.0.0.1 at a port the system chose, behind a token in the path', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    expect(server.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/[A-Za-z0-9_-]{32}/$`))
    expect(server.port).toBeGreaterThan(0)
  })

  it('serves the page at the tokened URL', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const res = await get(server.url)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toContain('<div id="root">')
  })

  it('answers 404 for a wrong token, the same as for any unknown path', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const wrong = server.url.replace(/\/[^/]+\/$/, '/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/')
    expect((await get(wrong)).status).toBe(404)
    expect((await get(`http://127.0.0.1:${server.port}/`)).status).toBe(404)
    expect((await get(`${server.url}nope`)).status).toBe(404)
  })

  // A page on another site can point a hostname it controls at 127.0.0.1
  // and read the answer as same-origin. The Host header is what gives that
  // away, whatever the token.
  it('refuses a request whose Host is not this server, which is how DNS rebinding shows itself', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const res = await get(server.url, { headers: { host: `evil.example:${server.port}` } })
    expect(res.status).toBe(421)
    expect(res.body).not.toContain('<div id="root">')
    const ok = await get(server.url, { headers: { host: `localhost:${server.port}` } })
    expect(ok.status).toBe(200)
  })

  it('refuses a cross-site request even with the right token', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const res = await get(`${server.url}api/stats`, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })

  // Someone clicks the URL in a chat or a mail client: a cross-site
  // navigation. That is the person opening their own page, and the token
  // came with the link; refusing it would break the ordinary way in.
  it('lets a cross-site navigation open the page, which is someone following the link', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const res = await get(server.url, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })
    expect(res.status).toBe(200)
  })

  it('answers only reads', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    expect((await get(server.url, { method: 'POST' })).status).toBe(405)
    expect((await get(server.url, { method: 'HEAD' })).status).toBe(200)
  })

  it('queries the job store on every request, so a review that lands shows without a restart', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const before = JSON.parse((await get(`${server.url}api/stats?range=all`)).body)
    expect(before.review.entries).toBe(0)
    reviewed(42)
    const after = JSON.parse((await get(`${server.url}api/stats?range=all`)).body)
    expect(after.review.entries).toBe(42)
    expect(after.range).toBe('all')
  })

  it('applies the range the page asks for, and the floor the caller set', async () => {
    reviewed(10)
    server = await startStatsServer({ port: 0, jobsDb: db, since: Date.now() + 1000 })
    const res = JSON.parse((await get(`${server.url}api/stats?range=30d`)).body)
    expect(res.range).toBe('30d')
    expect(res.review.entries).toBe(0)
  })

  it('picks the page language from Accept-Language, and lets ?lang= override it', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const tr = await get(server.url, { headers: { 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' } })
    expect(tr.body).toContain('<html lang="tr"')
    const en = await get(`${server.url}?lang=en`, { headers: { 'accept-language': 'tr-TR' } })
    expect(en.body).toContain('<html lang="en"')
  })

  it('sends headers that keep the token and the page to itself', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const res = await get(server.url)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'")
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'")
  })

  it('answers a favicon request quietly, without the token', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    expect((await get(`http://127.0.0.1:${server.port}/favicon.ico`)).status).toBe(204)
  })

  it('answers 500 and reports through onError when the job store fails for a reason other than being busy', async () => {
    const errors: Error[] = []
    server = await startStatsServer({ port: 0, jobsDb: db, onError: (e) => errors.push(e) })
    db.close()
    const res = await get(`${server.url}api/stats`)
    expect(res.status).toBe(500)
    expect(errors).toHaveLength(1)
  })

  // A review commits in a write transaction; a read that meets a checkpoint
  // can still time out. That is weather, not a fault: the page says busy and
  // retries, and the TUI's footer is not bothered with it.
  it('tells a busy job store apart from a broken one', () => {
    expect(isBusy(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(true)
    expect(isBusy(Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' }))).toBe(true)
    expect(isBusy(new Error('The database connection is not open'))).toBe(false)
  })

  it('closes idempotently, even with a browser holding a keep-alive connection open', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    const socket = createConnection(server.port, '127.0.0.1')
    await new Promise((r) => socket.once('connect', r))
    socket.write(`GET ${new URL(server.url).pathname} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: keep-alive\r\n\r\n`)
    await new Promise((r) => socket.once('data', r))
    const closing = server.close()
    await expect(Promise.race([closing.then(() => 'closed'), new Promise((r) => setTimeout(() => r('hung'), 2000))])).resolves.toBe('closed')
    await server.close()
    await expect(get(server.url)).rejects.toThrow()
    socket.destroy()
  })

  it('closes the job store it opened itself, and leaves one it was given open', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    await server.close()
    expect(db.open).toBe(true)
  })

  it('opens the job store under the isolated test home when it is given none', async () => {
    // test/setup/isolate-home.ts points POLYGLOTS_HOME at a temp directory;
    // the real ~/.local/share/polyglots must never be reached from a test.
    expect(jobsDbFile()).toContain(tmpdir().replace(/^\/private/, ''))
    server = await startStatsServer({ port: 0 })
    expect((await get(`${server.url}api/stats`)).status).toBe(200)
  })

  it('never writes to the terminal, which the TUI owns', async () => {
    const out = process.stdout.write
    const err = process.stderr.write
    const written: string[] = []
    process.stdout.write = ((s: string) => (written.push(s), true)) as typeof process.stdout.write
    process.stderr.write = ((s: string) => (written.push(s), true)) as typeof process.stderr.write
    try {
      server = await startStatsServer({ port: 0, jobsDb: db })
      await get(server.url)
      await get(`${server.url}nope`)
      await server.close()
    } finally {
      process.stdout.write = out
      process.stderr.write = err
    }
    expect(written).toEqual([])
  })
})

describe('openInBrowser', () => {
  function fakeSpawn(event: 'spawn' | 'error') {
    const calls: Array<[string, string[]]> = []
    const options: unknown[] = []
    let unrefs = 0
    const spawn = (command: string, args: string[], opts: unknown) => {
      calls.push([command, args])
      options.push(opts)
      return {
        once(e: 'spawn' | 'error', listener: () => void) {
          if (e === event) queueMicrotask(listener)
          return this
        },
        unref() {
          unrefs += 1
        },
      }
    }
    return { calls, options, spawn, unrefs: () => unrefs }
  }

  // The TUI calls this while Ink owns the terminal. An opener that inherited
  // the terminal would paint over the frame, and one left referenced would
  // hold the process open after the app quit.
  it('detaches the opener from the terminal and from the process', async () => {
    const s = fakeSpawn('spawn')
    await openInBrowser('u', { platform: 'darwin', env: {}, spawn: s.spawn })
    expect(s.options).toEqual([expect.objectContaining({ detached: true, stdio: 'ignore' })])
    expect(s.unrefs()).toBe(1)
  })

  it('uses the platform opener', async () => {
    const mac = fakeSpawn('spawn')
    expect(await openInBrowser('http://127.0.0.1:1/t/', { platform: 'darwin', env: {}, spawn: mac.spawn })).toBe(true)
    expect(mac.calls).toEqual([['open', ['http://127.0.0.1:1/t/']]])
    const linux = fakeSpawn('spawn')
    await openInBrowser('u', { platform: 'linux', env: { DISPLAY: ':0' }, spawn: linux.spawn })
    expect(linux.calls[0]![0]).toBe('xdg-open')
  })

  it('does not try over SSH or on a Linux machine with no display, where there is no screen to open on', async () => {
    const s = fakeSpawn('spawn')
    expect(await openInBrowser('u', { platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' }, spawn: s.spawn })).toBe(false)
    expect(await openInBrowser('u', { platform: 'linux', env: {}, spawn: s.spawn })).toBe(false)
    expect(s.calls).toEqual([])
  })

  it('reports false rather than throwing when the opener is missing', async () => {
    const s = fakeSpawn('error')
    expect(await openInBrowser('u', { platform: 'linux', env: { DISPLAY: ':0' }, spawn: s.spawn })).toBe(false)
  })
})

// The page keeps its settings in localStorage, which belongs to the origin,
// and the origin includes the port: a port that changed every run lost them.
describe('the stats server port', () => {
  async function freePort(): Promise<number> {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address() as { port: number }
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return port
  }

  it('is fixed, below every ephemeral range, so the OS does not hand it out', () => {
    expect(STATS_PORT).toBe(29117)
    expect(STATS_PORT).toBeLessThan(32768)
  })

  it('binds the port it is asked for when that port is free', async () => {
    const port = await freePort()
    server = await startStatsServer({ port, jobsDb: db })
    expect(server.port).toBe(port)
    expect(server.url).toContain(`127.0.0.1:${port}/`)
    expect(server.portInUse).toBeUndefined()
  })

  it('serves on another port when its own is taken, and says which was taken', async () => {
    const squatter = createServer()
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve))
    const { port } = squatter.address() as { port: number }
    try {
      server = await startStatsServer({ port, jobsDb: db })
      expect(server.port).not.toBe(port)
      expect(server.portInUse).toBe(port)
      expect((await get(server.url)).status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  })
})

// A second polyglots asking for the port finds the first one's server and
// uses its address instead of starting another. The address carries the
// token, so it is never given out over HTTP: the server that holds the port
// writes it to a file only this user can read, and the header says which
// server answers at the port, so a stale file cannot send anyone elsewhere.
describe('sharing one server between polyglots instances', () => {
  let other: StatsServer | undefined
  afterEach(async () => {
    await other?.close()
    other = undefined
  })

  async function freePort(): Promise<number> {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address() as { port: number }
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return port
  }

  it('marks every response as coming from polyglots', async () => {
    server = await startStatsServer({ port: 0, jobsDb: db })
    expect((await get(server.url)).headers['x-polyglots']).toBe('stats')
    expect((await get(server.url.replace(/[^/]+\/$/, 'wrong/'))).headers['x-polyglots']).toBe('stats')
  })

  it('records its address for this user only while it holds the port', async () => {
    const recordFile = join(dir, 'stats-server.json')
    server = await startStatsServer({ port: await freePort(), jobsDb: db, recordFile })
    const record = JSON.parse(readFileSync(recordFile, 'utf8')) as { url: string; pid: number }
    expect(record).toEqual({ url: server.url, pid: process.pid })
    expect(statSync(recordFile).mode & 0o777).toBe(0o600)
    await server.close()
    server = undefined
    expect(existsSync(recordFile)).toBe(false)
  })

  it('uses the address of a polyglots server already on the port, and leaves it serving', async () => {
    const recordFile = join(dir, 'stats-server.json')
    const port = await freePort()
    other = await startStatsServer({ port, jobsDb: db, recordFile })
    server = await startStatsServer({ port, jobsDb: db, recordFile })
    expect(server.url).toBe(other.url)
    expect(server.sharedWith).toEqual({ pid: process.pid })
    expect(server.portInUse).toBeUndefined()
    await server.close()
    server = undefined
    expect((await get(other.url)).status).toBe(200)
    expect(existsSync(recordFile)).toBe(true)
  })

  it('does not trust a record whose address does not answer as polyglots', async () => {
    const recordFile = join(dir, 'stats-server.json')
    const squatter = createServer((_req, res) => res.end('hello'))
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve))
    const { port } = squatter.address() as { port: number }
    writeFileSync(recordFile, JSON.stringify({ url: `http://127.0.0.1:${port}/tok/`, pid: 1 }))
    try {
      server = await startStatsServer({ port, jobsDb: db, recordFile })
      expect(server.sharedWith).toBeUndefined()
      expect(server.portInUse).toBe(port)
      expect(server.port).not.toBe(port)
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()))
    }
  })
})
