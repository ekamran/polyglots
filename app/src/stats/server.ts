import { spawn as spawnProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../jobs/index.js'
import { renderDocument } from './document.js'
import { BUILT_IN_LANGUAGES, languageByTag, negotiate } from './i18n.js'
import { parseRange } from './page/model.js'
import { buildPayload } from './payload.js'

// A read-only HTTP server for the stats page, on 127.0.0.1 only.
//
// Localhost is not private from the browser: any page the reader has open can
// send requests to 127.0.0.1, and a page that points its own hostname at
// 127.0.0.1 (DNS rebinding) can read the answers as same-origin. Three fences,
// each covering a gap in the others:
//
//   - A random token as the first path segment. A page elsewhere cannot guess
//     it, and the page's own relative fetches carry it with no cookie.
//   - The Host header must name this server. A rebinding page's requests carry
//     its own hostname, so this refuses them before the token is even read.
//   - A cross-site request that is not a top-level navigation is refused,
//     for browsers that send Sec-Fetch headers.
//
// One exposure the token does not cover: openInBrowser passes the URL to
// open, xdg-open or start as an argument, so for the moment that process
// lives the token is visible to anyone on the machine who can run ps. The
// window is short, and what the token opens is read-only statistics.
//
// The server never writes to the job store and never writes to the terminal:
// the TUI owns the screen while it runs, and the CLI prints for itself.

export interface StatsServerOptions {
  // Tests pass a temporary store. Omitted: opens the user's own through
  // openJobsDb() and closes it on close().
  jobsDb?: Database.Database
  // A floor under every range, in epoch milliseconds: the CLI's --since.
  since?: number
  now?: () => Date
  // Errors after start: a failed query that is not the store being busy, or
  // the HTTP server itself. Omitted, they are dropped (the request already
  // got a 500).
  onError?: (err: Error) => void
}

export interface StatsServer {
  // http://127.0.0.1:PORT/<token>/, ready to open.
  url: string
  port: number
  // Idempotent. Drops open connections, so a browser's keep-alive socket
  // cannot hold a quit open, and closes a job store this server opened.
  close(): Promise<void>
}

/** Whether a query failed because another connection held the store, rather than because something is broken. */
export function isBusy(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  // The token is in the URL, and a referrer would carry it to any link.
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function startStatsServer(opts: StatsServerOptions = {}): Promise<StatsServer> {
  const ownsDb = opts.jobsDb === undefined
  const db = opts.jobsDb ?? openJobsDb()
  const now = opts.now ?? (() => new Date())
  const report = (err: unknown) => opts.onError?.(err instanceof Error ? err : new Error(String(err)))
  // 24 bytes is 32 base64url characters: far past guessing, short enough to
  // read off a terminal if the browser does not open.
  const token = randomBytes(24).toString('base64url')
  let port = 0

  function send(res: ServerResponse, head: boolean, status: number, type: string, body: string, extra = {}): void {
    res.writeHead(status, { ...BASE_HEADERS, 'content-type': type, 'content-length': Buffer.byteLength(body), ...extra })
    res.end(head ? undefined : body)
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const head = req.method === 'HEAD'
    const host = req.headers.host
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      send(res, head, 421, 'text/plain; charset=utf-8', 'Misdirected request\n')
      return
    }
    if (req.method !== 'GET' && !head) {
      send(res, head, 405, 'text/plain; charset=utf-8', 'Method not allowed\n', { allow: 'GET, HEAD' })
      return
    }
    // A cross-site navigation is someone following the link from a chat or a
    // mail client, and is let through (framing is refused by the policy). A
    // cross-site fetch is another page reading this one, and is not.
    const navigating = req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'
    if (req.headers['sec-fetch-site'] === 'cross-site' && !navigating) {
      send(res, head, 403, 'text/plain; charset=utf-8', 'Forbidden\n')
      return
    }
    const url = new URL(req.url ?? '/', `http://${host}`)
    // Browsers ask for this on their own, without the token; a 404 would put
    // an error in the console of a page that is working.
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, BASE_HEADERS)
      res.end()
      return
    }
    const [, first = '', ...rest] = url.pathname.split('/')
    if (!sameToken(first, token)) {
      send(res, head, 404, 'text/plain; charset=utf-8', 'Not found\n')
      return
    }
    const route = rest.join('/')
    if (rest.length === 0) {
      // Without the slash the page's relative fetches would resolve one level
      // up and lose the token.
      res.writeHead(308, { ...BASE_HEADERS, location: `/${token}/${url.search}` })
      res.end()
      return
    }
    try {
      if (route === '') {
        const range = parseRange(url.searchParams.get('range'))
        const lang =
          languageByTag(url.searchParams.get('lang'), BUILT_IN_LANGUAGES) ??
          negotiate(req.headers['accept-language'], BUILT_IN_LANGUAGES)
        const payload = buildPayload(db, { range, now: now(), ...(opts.since === undefined ? {} : { floor: opts.since }) })
        const doc = renderDocument({ mode: 'server', range, payloads: { [range]: payload }, lang })
        send(res, head, 200, 'text/html; charset=utf-8', doc.html, {
          // frame-ancestors only works as a header, never in a meta tag.
          'content-security-policy': `${doc.csp}; frame-ancestors 'none'`,
          'content-language': lang.tag,
          vary: 'Accept-Language',
        })
        return
      }
      if (route === 'api/stats') {
        const range = parseRange(url.searchParams.get('range'))
        const payload = buildPayload(db, { range, now: now(), ...(opts.since === undefined ? {} : { floor: opts.since }) })
        send(res, head, 200, 'application/json; charset=utf-8', JSON.stringify(payload))
        return
      }
      send(res, head, 404, 'text/plain; charset=utf-8', 'Not found\n')
    } catch (err) {
      if (isBusy(err)) {
        send(res, head, 503, 'application/json; charset=utf-8', '{"error":"busy"}', { 'retry-after': '2' })
        return
      }
      report(err)
      send(res, head, 500, 'application/json; charset=utf-8', '{"error":"failed"}')
    }
  }

  const server = createServer(handle)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (err) {
    if (ownsDb) db.close()
    throw err
  }
  server.on('error', report)
  const address = server.address()
  port = typeof address === 'object' && address !== null ? address.port : 0

  let closing: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${port}/${token}/`,
    port,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => {
          if (ownsDb && db.open) db.close()
          resolve()
        })
        server.closeAllConnections()
      })
      return closing
    },
  }
}

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => { once(event: 'spawn' | 'error', listener: () => void): unknown; unref(): void }

const OPENER_OPTIONS: SpawnOptions = { detached: true, stdio: 'ignore', windowsHide: true }

export interface OpenOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  spawn?: Spawn
}

/**
 * Opens a URL in the default browser. Never throws: false when it did not
 * try, because there is no screen to open on (an SSH session, or Linux with
 * no display), or when the opener could not be started. The caller prints
 * the URL either way.
 */
export function openInBrowser(url: string, opts: OpenOptions = {}): Promise<boolean> {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  // Over SSH a browser would open on the far machine's desktop, if anywhere,
  // which is not where the person typing is looking.
  if (env.SSH_CONNECTION || env.SSH_TTY) return Promise.resolve(false)
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return Promise.resolve(false)
  const [command, args]: [string, string[]] =
    platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]]
  const spawn: Spawn = opts.spawn ?? spawnProcess
  return new Promise((resolve) => {
    try {
      // Detached, with no stdio and unref'd once started: the TUI calls this
      // while Ink owns the terminal, and an opener that inherited it would
      // paint over the frame, or hold the process open after the app quits.
      const child = spawn(command, args, OPENER_OPTIONS)
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
      child.once('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}
