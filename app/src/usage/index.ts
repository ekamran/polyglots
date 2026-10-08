import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, join } from 'node:path'
import { loadConfig } from '../config.js'
import { dataDir } from '../paths.js'
import type { PolyglotsConfig } from '../types.js'
import { VERSION } from '../version.js'
import { buildUsagePayload, type UsagePayload } from './payload.js'

export { buildUsagePayload, type UsagePayload } from './payload.js'

// Opt-in anonymous usage totals, issue #19. Off unless config.json says
// `usageStats: true` and DO_NOT_TRACK does not say otherwise. What is sent is
// built in payload.ts, so anyone can read exactly what leaves the machine.

export const DEFAULT_USAGE_URL = 'https://ada.tools/polyglots/api/usage'

const DAY = 86_400_000
// The cadence the issue promises: at most one payload per install per week.
export const SEND_EVERY_MS = 7 * DAY
// After a failed attempt. Without it, an endpoint that is down would be tried
// at the start of every command until it came back; with it, a failure costs
// one request a day, and nothing is queued: the next attempt builds a fresh
// payload from whatever the job store holds then.
export const RETRY_AFTER_MS = DAY
// Short, because nothing is waiting on the answer. It bounds how long a socket
// lingers inside a long-lived process like the TUI; a short command never
// waits for it at all, see send().
export const SEND_TIMEOUT_MS = 5000

/**
 * The convention (consoledonottrack.com) is "set to 1", but people write
 * true and yes too, and a variable named DO_NOT_TRACK that is set to anything
 * but an explicit no is someone asking not to be tracked.
 */
export function doNotTrack(env: NodeJS.ProcessEnv): boolean {
  const value = env.DO_NOT_TRACK?.trim().toLowerCase()
  return value !== undefined && value !== '' && value !== '0' && value !== 'false' && value !== 'no'
}

export function usageEnabled(config: Pick<PolyglotsConfig, 'usageStats'>, env: NodeJS.ProcessEnv): boolean {
  return config.usageStats === true && !doNotTrack(env)
}

/** Where the payload goes. Overridable so tests, and anyone self-hosting the endpoint, can point it elsewhere. */
export function usageUrl(env: NodeJS.ProcessEnv): string {
  const value = env.POLYGLOTS_USAGE_URL?.trim()
  return value ? value : DEFAULT_USAGE_URL
}

// The install id and when it last sent, beside jobs.db in the data directory
// rather than in config.json. Not a setting: nobody should copy it to another
// machine with their config, where two installs would then overwrite each
// other's totals on the server. And kept out of jobs.db, which is disposable:
// deleting that store should cost a re-review, not mint a new install that
// counts the same person twice.
export interface UsageState {
  installId: string
  // Of the last send the server accepted, or answered 429 to.
  lastSentAt?: number
  // Of the last attempt, successful or not. Written before the request goes,
  // so two commands started together do not both send.
  lastAttemptAt?: number
}

export function usageStateFile(): string {
  return join(dataDir(), 'usage.json')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The saved state, or undefined when there is none or it is unreadable. */
export function readUsageState(): UsageState | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(usageStateFile(), 'utf8'))
    if (raw === null || typeof raw !== 'object') return undefined
    const { installId, lastSentAt, lastAttemptAt } = raw as Record<string, unknown>
    if (typeof installId !== 'string' || !UUID.test(installId)) return undefined
    return {
      installId,
      ...(typeof lastSentAt === 'number' ? { lastSentAt } : {}),
      ...(typeof lastAttemptAt === 'number' ? { lastAttemptAt } : {}),
    }
  } catch {
    return undefined
  }
}

function writeUsageState(state: UsageState): void {
  const path = usageStateFile()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/**
 * The install id, made now if there is none. Only ever called once the person
 * has opted in: the off path in this module never reaches it, which the tests
 * hold it to.
 */
export function ensureInstallId(): string {
  const existing = readUsageState()
  if (existing) return existing.installId
  const installId = randomUUID()
  writeUsageState({ installId })
  return installId
}

/**
 * Forgets the install id, and with it when it last sent. A new one is made
 * the next time a payload is built with the setting on.
 *
 * The server still holds the old id's last totals and goes on counting them;
 * the new id then reports the same work again. That double count is the price
 * of an id the server cannot tie to the old one, which is the point of
 * resetting it.
 */
export function resetUsageState(): boolean {
  try {
    rmSync(usageStateFile())
    return true
  } catch {
    return false
  }
}

/**
 * The payload the next send would carry, or undefined while the setting is
 * off. Makes the install id when it is on and there is none yet, so what
 * `usage-stats show` prints is exactly what goes.
 */
export function nextUsagePayload(opts: { config: Pick<PolyglotsConfig, 'usageStats'>; env: NodeJS.ProcessEnv; version?: string; jobsPath?: string }): UsagePayload | undefined {
  if (!usageEnabled(opts.config, opts.env)) return undefined
  return buildUsagePayload({
    installId: ensureInstallId(),
    version: opts.version ?? VERSION,
    ...(opts.jobsPath === undefined ? {} : { jobsPath: opts.jobsPath }),
  })
}

// Stands in for the id in a preview shown while the setting is off. Not
// shaped like a UUID, so nothing could mistake it for one that was sent.
export const PLACEHOLDER_INSTALL_ID = '(made when you turn this on)'

/** Why sending is on or off, for the CLI and the TUI to say in words. */
export type UsageStatus = 'on' | 'off' | 'unanswered' | 'do-not-track'

export function usageStatus(config: Pick<PolyglotsConfig, 'usageStats'>, env: NodeJS.ProcessEnv): UsageStatus {
  if (config.usageStats === true) return doNotTrack(env) ? 'do-not-track' : 'on'
  return config.usageStats === false ? 'off' : 'unanswered'
}

/**
 * What would be sent, for someone deciding whether to turn it on: the real
 * payload when on, and otherwise the same totals under a placeholder id, made
 * without creating an install id.
 */
export function previewUsagePayload(opts: { config: Pick<PolyglotsConfig, 'usageStats'>; env: NodeJS.ProcessEnv; version?: string; jobsPath?: string }): UsagePayload {
  return (
    nextUsagePayload(opts) ??
    buildUsagePayload({
      installId: PLACEHOLDER_INSTALL_ID,
      version: opts.version ?? VERSION,
      ...(opts.jobsPath === undefined ? {} : { jobsPath: opts.jobsPath }),
    })
  )
}

export type SendOutcome ='off' | 'not-due' | 'sent' | 'failed'

export interface SendOptions {
  // Read from config.json when absent.
  config?: Pick<PolyglotsConfig, 'usageStats'>
  env?: NodeJS.ProcessEnv
  now?: () => number
  version?: string
  jobsPath?: string
  timeoutMs?: number
}

/**
 * Posts the payload and settles on what came back. Never rejects.
 *
 * node:http rather than fetch, for unref: the socket and the timer are both
 * unreferenced, so a command that finishes while the request is in flight
 * exits at once and the request dies with it. fetch has no way to say that,
 * and a pending fetch holds the process open until it settles, which is
 * exactly the delay this must never cause.
 */
function post(url: string, body: string, timeoutMs: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return resolve(undefined)
    }
    const request = target.protocol === 'https:' ? httpsRequest : target.protocol === 'http:' ? httpRequest : undefined
    if (!request) return resolve(undefined)
    const req = request(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    })
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs)
    timer.unref()
    req.on('socket', (socket) => socket.unref())
    req.on('response', (res) => {
      res.resume()
      res.on('end', () => {
        clearTimeout(timer)
        resolve(res.statusCode)
      })
      res.on('error', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    req.end(body)
  })
}

/**
 * Sends this week's totals if the person opted in and a week has passed.
 *
 * Callers do not await it: the promise is for tests. Every failure, from an
 * unreadable config to a refused connection, ends as an outcome rather than a
 * throw, and nothing is printed: a usage send that interrupted someone's
 * review to say it could not reach a server would be worse than no send.
 */
export async function sendUsageInBackground(opts: SendOptions = {}): Promise<SendOutcome> {
  try {
    const env = opts.env ?? process.env
    // A config that cannot be read records no opt-in, so it is off, not a
    // failed send: there was never anything to send.
    let config: Pick<PolyglotsConfig, 'usageStats'>
    try {
      config = opts.config ?? loadConfig()
    } catch {
      return 'off'
    }
    if (!usageEnabled(config, env)) return 'off'
    const now = (opts.now ?? Date.now)()
    const state = readUsageState()
    if (state?.lastSentAt !== undefined && now - state.lastSentAt < SEND_EVERY_MS) return 'not-due'
    if (state?.lastAttemptAt !== undefined && now - state.lastAttemptAt < RETRY_AFTER_MS) return 'not-due'

    const payload = nextUsagePayload({
      config,
      env,
      ...(opts.version === undefined ? {} : { version: opts.version }),
      ...(opts.jobsPath === undefined ? {} : { jobsPath: opts.jobsPath }),
    })
    if (!payload) return 'off'
    const attempted: UsageState = { ...(readUsageState() ?? { installId: payload.installId }), lastAttemptAt: now }
    writeUsageState(attempted)

    const status = await post(usageUrl(env), JSON.stringify(payload), opts.timeoutMs ?? SEND_TIMEOUT_MS)
    // 429 is the server saying it already holds a payload from this id this
    // week, most often one whose answer was lost to the timeout. Treating it
    // as a failure would retry daily against a server that will keep saying so.
    if (status !== undefined && ((status >= 200 && status < 300) || status === 429)) {
      // Re-read, in case a reset happened while the request was out: the
      // send must not resurrect an id the person just threw away.
      const current = readUsageState()
      if (current?.installId === payload.installId) writeUsageState({ ...current, lastSentAt: now })
      return 'sent'
    }
    return 'failed'
  } catch {
    return 'failed'
  }
}
