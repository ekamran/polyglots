import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Locale } from '../types.js'
import { httpGet, type HttpGet } from '../wporg/http.js'
import {
  exportUrl,
  localePageUrl,
  projectFileName,
  readSubProjects,
  type FetchStatus,
  type ProjectRef,
  type ProjectType,
  type SubProject,
} from '../wporg/projects.js'

export type Resolution =
  | { input: string; state: 'ready'; type: ProjectType; slug: string; branch?: string; count: number }
  | { input: string; state: 'empty' | 'not-found' | 'unreachable'; reason: string }

export type Ready = Extract<Resolution, { state: 'ready' }>

export type Fetched =
  | { input: string; file: string; state: 'fetched' | 'kept' }
  | { input: string; state: 'failed'; reason: string }

// Half a second between requests. A list of thirty projects resolves in about
// thirty seconds either way, and wp.org is a volunteer-run service that answers
// a burst of scraper traffic by rate limiting everyone behind the same address.
const DEFAULT_PAUSE_MS = 500

// A locale page answers in a second or two, but an export of a project the size
// of WooCommerce is generated on request and takes minutes, not seconds.
const EXPORT_TIMEOUT_MS = 300_000

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

export function defaultOutDir(): string {
  return join(homedir(), 'Downloads', 'polyglots')
}

// How the line was written, for the tables. A resolved slug says less than the
// URL the person pasted, and they recognise their own input fastest.
const inputOf = (ref: ProjectRef) =>
  ref.type ? [ref.type, ref.slug, ref.branch].filter(Boolean).join('/') : ref.slug

type PageLookup =
  | { kind: 'rows'; rows: SubProject[] }
  | { kind: 'missing' }
  | { kind: 'unreachable'; reason: string }

/**
 * Picks the sub-project a run should work on.
 *
 * A theme has one. A plugin from a bare slug is dev or stable, whichever has
 * more strings in the chosen status, because that is where the work is; a tie
 * goes to dev, where new strings land first. The readme sub-projects are never
 * picked this way: they hold the plugin directory's marketing copy, a different
 * job from the plugin's interface, and somebody who wants them can paste the
 * URL that names one.
 */
function pickRow(
  type: ProjectType,
  rows: SubProject[],
  branch: string | undefined,
  status: FetchStatus,
): SubProject | undefined {
  if (type === 'wp-themes') return rows[0]
  if (branch !== undefined) return rows.find((r) => r.branch === branch)
  const dev = rows.find((r) => r.branch === 'dev')
  const stable = rows.find((r) => r.branch === 'stable')
  if (!dev || !stable) return dev ?? stable
  return stable[status] > dev[status] ? stable : dev
}

/**
 * Turns each line of input into a project that exists and has work, or a
 * reason it does not.
 *
 * A bare slug is tried as a theme first and as a plugin second. The order only
 * matters for a slug wp.org has as both, which is rare and resolves to the theme
 * because this tool's daily use is themes.
 *
 * Only a 404 is "not found". A server error, a timeout or a network failure is
 * "unreachable" and stops the lookup for that line there: trying the plugin
 * after the theme page failed to answer could resolve a theme as a same-named
 * plugin, and reporting an outage as a missing project would quietly drop real
 * work from the batch.
 *
 * Requests are sequential with a pause between them. Resolution is a handful of
 * small pages against a volunteer-run server, and finishing it a few seconds
 * sooner is not worth being the reason it rate limits.
 */
export async function resolveProjects(
  refs: ProjectRef[],
  opts: { locale: Locale; status: FetchStatus; http?: HttpGet; pauseMs?: number },
): Promise<Resolution[]> {
  const http = opts.http ?? httpGet
  const pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS
  let first = true

  const lookup = async (type: ProjectType, slug: string): Promise<PageLookup> => {
    if (!first) await sleep(pauseMs)
    first = false
    const url = localePageUrl(type, slug, opts.locale)
    let res
    try {
      res = await http(url)
    } catch (err) {
      return { kind: 'unreachable', reason: err instanceof Error ? err.message : String(err) }
    }
    if (res.status === 404) return { kind: 'missing' }
    if (res.status !== 200) return { kind: 'unreachable', reason: `GET ${url} answered ${res.status}` }
    // A 200 without the sub-project table is not a project page, whatever
    // wp.org chose to show instead, so it counts as missing for this type.
    const rows = readSubProjects(res.body, type)
    return rows.length === 0 ? { kind: 'missing' } : { kind: 'rows', rows }
  }

  const results: Resolution[] = []
  for (const ref of refs) {
    const input = inputOf(ref)
    const types: ProjectType[] = ref.type ? [ref.type] : ['wp-themes', 'wp-plugins']
    let resolution: Resolution | undefined
    for (const type of types) {
      const page = await lookup(type, ref.slug)
      if (page.kind === 'missing') continue
      if (page.kind === 'unreachable') {
        resolution = { input, state: 'unreachable', reason: page.reason }
        break
      }
      const row = pickRow(type, page.rows, ref.branch, opts.status)
      if (!row) {
        resolution = { input, state: 'not-found', reason: `${type}/${ref.slug} has no ${ref.branch} sub-project` }
        break
      }
      const count = row[opts.status]
      resolution =
        count === 0
          ? { input, state: 'empty', reason: `nothing ${opts.status}` }
          : {
              input,
              state: 'ready',
              type,
              slug: ref.slug,
              ...(row.branch === undefined ? {} : { branch: row.branch }),
              count,
            }
      break
    }
    results.push(resolution ?? { input, state: 'not-found', reason: `no theme or plugin named ${ref.slug}` })
  }
  return results
}

/**
 * Where an export is saved.
 *
 * A waiting export takes the name the requester link is read back from, since
 * only a review posts a message back. An untranslated export takes its own
 * name. Sharing one would let a translate run find a waiting export left by an
 * earlier review, keep it as somebody's work, and translate a file with no
 * empty entries: nothing done, and the project reported finished.
 */
export function exportFileName(r: Ready, locale: Locale, status: FetchStatus): string {
  const name = projectFileName(r.type, r.slug, r.branch, locale)
  return status === 'waiting' ? name : name.replace(/\.po$/, '-untranslated.po')
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/**
 * Downloads each ready project's export under `exportFileName`, so a reviewed
 * file's requester message links to the right page without anyone renaming it.
 *
 * Review and translate treat an existing file differently, because they treat
 * the file differently. Review reads the export and writes its output beside
 * it, and waiting strings keep arriving, so an old export is only stale and is
 * replaced. Translate writes into the file it is given, so an existing one may
 * be a half-finished run or somebody's hand edits, and is kept unless `force`
 * says otherwise. Translate's own cache makes reusing it cheap.
 *
 * A 200 whose body has no msgid is refused. wp.org answers a logged-out or
 * broken export with an HTML page and a success status, and saving that as a
 * catalogue would fail later, in the run, with a parse error that names the
 * file and not the cause. Nothing is written in that case, and the write that
 * does happen goes through a temporary name so an interrupted download never
 * leaves half a catalogue under the real one.
 */
export async function fetchProjects(
  ready: Ready[],
  opts: { locale: Locale; status: FetchStatus; outDir: string; force?: boolean; http?: HttpGet; pauseMs?: number },
): Promise<Fetched[]> {
  const http = opts.http ?? httpGet
  const pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS
  await mkdir(opts.outDir, { recursive: true })

  const results: Fetched[] = []
  let first = true
  for (const p of ready) {
    const file = join(opts.outDir, exportFileName(p, opts.locale, opts.status))
    if (opts.status === 'untranslated' && !opts.force && (await exists(file))) {
      results.push({ input: p.input, file, state: 'kept' })
      continue
    }
    if (!first) await sleep(pauseMs)
    first = false
    const url = exportUrl(p.type, p.slug, p.branch, opts.locale, opts.status)
    try {
      const res = await http(url, { timeoutMs: EXPORT_TIMEOUT_MS })
      if (res.status !== 200) {
        results.push({ input: p.input, state: 'failed', reason: `export answered ${res.status}` })
        continue
      }
      if (!/^msgid /m.test(res.body)) {
        results.push({ input: p.input, state: 'failed', reason: 'export is not a catalogue' })
        continue
      }
      const tmp = `${file}.part`
      await writeFile(tmp, res.body, 'utf8')
      await rename(tmp, file)
      results.push({ input: p.input, file, state: 'fetched' })
    } catch (err) {
      results.push({ input: p.input, state: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
