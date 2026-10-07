import { text } from 'node:stream/consumers'
import { LOCAL_REVIEW_NOTICE, localReviewBatchSize } from '../review/local.js'
import { agentBinOverride, batchAdvice } from '../agent/providers.js'
import { runProjects, withSharedDbs, MAX_PARALLEL } from '../commands/batch.js'
import { defaultOutDir, type fetchProjects, type resolveProjects, type Fetched, type Resolution } from '../commands/fetch.js'
import {
  describeResolution,
  endOfJob,
  endOfResolution,
  tallyOf,
  waitNotice,
  type BatchSummary,
  type ProjectEnd,
} from '../commands/fetch-report.js'
import type { reviewFile } from '../commands/review.js'
import type { translateFile } from '../commands/translate.js'
import { loadSecrets } from '../config.js'
import { loadLocaleRules } from '../rules/load.js'
import { createRunControl, type RunControl, type RunState } from '../run-control.js'
import type { PolyglotsConfig } from '../types.js'
import { parseProjectLines, type FetchStatus } from '../wporg/projects.js'
import { UsageError, parseDraftEngine, parseLocaleArg, parsePositiveInt, secretForEngine } from './args.js'
import { watchKeys, type KeyStream } from './keys.js'
import type { Painter } from '../ui/paint.js'
import { warnLine } from '../ui/messages.js'
import { table } from '../ui/layout.js'
import { fetchTally, tallyCell } from './summaries.js'

export interface FetchFlags {
  get?: string
  parallel?: string
  outDir?: string
  force?: boolean
  batchSize?: string
  fresh?: boolean
  ai?: boolean
  draftEngine?: string
  locale?: string
}

export interface FetchCli {
  stdin: NodeJS.ReadableStream & KeyStream
  config: () => PolyglotsConfig
  resolveProjects: typeof resolveProjects
  fetchProjects: typeof fetchProjects
  reviewFile: typeof reviewFile
  translate: typeof translateFile
  ui: { out: Painter; err: Painter }
  out(line: string): void
  err(line: string): void
}

const EXIT_OK = 0
const EXIT_ERROR = 1
const EXIT_STOPPED = 3

function parseFetchStatus(raw: string | undefined): FetchStatus {
  if (raw === 'waiting' || raw === 'untranslated') return raw
  throw new UsageError(
    raw === undefined
      ? '--get is required: waiting (to review) or untranslated (to translate)'
      : `--get must be waiting (to review) or untranslated (to translate), got "${raw}"`,
  )
}

/**
 * `polyglots fetch`: resolve a list of projects, download their waiting or
 * untranslated strings, and review or translate every one.
 *
 * The status decides the action. Waiting strings are somebody's submission and
 * are reviewed; untranslated ones are translated. Never both, so a run can never
 * translate over the submissions other contributors are waiting on.
 *
 * Both databases are opened once for the batch and handed to every job. Each
 * job opening its own would put several writers on one WAL file from one
 * process for no gain, and better-sqlite3 is synchronous, so jobs sharing a
 * handle cannot interleave a write.
 *
 * Progress is one line per project on stderr rather than the per-batch bar a
 * single run draws. Several jobs redrawing one bar line at once would garble
 * it, and with one slot the start and end lines read as a queue.
 */
export async function runFetch(cli: FetchCli, names: string[], flags: FetchFlags): Promise<number> {
  const status = parseFetchStatus(flags.get)
  const parallel = flags.parallel === undefined ? 1 : parsePositiveInt('--parallel', flags.parallel)
  if (parallel > MAX_PARALLEL) {
    throw new UsageError(
      `--parallel is at most ${MAX_PARALLEL}; past that the provider's rate limit sets the pace, not the job count`,
    )
  }
  const config = cli.config()
  const locale = parseLocaleArg(flags.locale ?? config.defaultLocale)
  loadLocaleRules(locale)
  // The experimental local reviewer gets its own small default, as on review
  // and translate; see resolveBatchSize in cli.ts.
  const batchSize =
    flags.batchSize !== undefined
      ? parsePositiveInt('--batch-size', flags.batchSize)
      : config.reviewProvider === 'local'
        ? localReviewBatchSize(config.batchSize)
        : config.batchSize
  const outDir = flags.outDir ?? defaultOutDir()
  const review = status === 'waiting'

  // A pasted list arrives on stdin; a terminal on stdin means nobody piped one.
  const piped = cli.stdin.isTTY === true ? '' : await text(cli.stdin)
  const refs = parseProjectLines([...names, piped].join('\n'))
  if (refs.length === 0) throw new UsageError('No projects given. Name them as arguments, or pipe a list on stdin.')

  // Checked before any request, so a missing key is not found out after the
  // downloads, as the first job's failure, then again for every other job.
  const draftEngine = parseDraftEngine(flags.draftEngine ?? config.defaultDraftEngine)
  const secrets = review ? {} : loadSecrets()
  if (!review) {
    const secretName = secretForEngine(draftEngine)
    if (secretName && !secrets[secretName]?.trim()) {
      throw new Error(`Draft engine "${draftEngine}" needs ${secretName}. Set it with: polyglots config set-key ${secretName}`)
    }
  } else {
    const advice = batchAdvice(config.reviewProvider, batchSize)
    if (advice) cli.err(warnLine(cli.ui.err, advice))
  }
  if (config.reviewProvider === 'local' && !(review && flags.ai === false)) cli.err(warnLine(cli.ui.err, LOCAL_REVIEW_NOTICE))

  cli.err(`Checking ${refs.length} ${refs.length === 1 ? 'project' : 'projects'} on translate.wordpress.org...`)
  const onWait = (ms: number) => cli.err(waitNotice(ms))
  const resolutions = await cli.resolveProjects(refs, { locale, status, onWait })
  for (const line of table(resolutions.map((r) => [r.input, describeResolution(r, status)]), { indent: 2 })) cli.out(line)

  const ends = new Map<string, ProjectEnd>()
  for (const r of resolutions) {
    const end = endOfResolution(r, status)
    if (end) ends.set(r.input, end)
  }

  const ready = resolutions.filter((r): r is Extract<Resolution, { state: 'ready' }> => r.state === 'ready')
  if (ready.length > 0) {
    cli.err(`Downloading ${ready.length} ${ready.length === 1 ? 'export' : 'exports'} to ${outDir}...`)
    const fetched = await cli.fetchProjects(ready, {
      locale,
      status,
      outDir,
      onWait,
      ...(flags.force ? { force: true } : {}),
    })
    const toRun: Array<Extract<Fetched, { file: string }>> = []
    for (const f of fetched) {
      if (f.state === 'failed') ends.set(f.input, { tally: 'failed', detail: `download failed: ${f.reason}` })
      else toRun.push(f)
    }
    if (toRun.length > 0) await runJobs(cli, toRun, ends, { review, locale, batchSize, parallel, draftEngine, secrets, flags })
  }

  cli.out('')
  const final = resolutions.map((r): ProjectEnd => ends.get(r.input) ?? { tally: 'failed', detail: 'never ran' })
  const rows = resolutions.map((r, i) => [r.input, tallyCell(cli.ui.out, final[i]!.tally), final[i]!.detail])
  for (const line of table(rows, { indent: 2 })) cli.out(line)
  const tally = tallyOf(final)

  // One message per reviewed project, because each goes back to a different
  // contributor. Printed rather than copied, as for a single review.
  for (const r of resolutions) {
    const message = ends.get(r.input)?.message
    if (!message) continue
    cli.out('')
    cli.out(`Message for the requester (${r.input}):`)
    cli.out(message)
  }

  cli.out('')
  for (const line of fetchTally(cli.ui.out, tally)) cli.out(line)
  if (tally.failed > 0) return EXIT_ERROR
  return tally.stopped > 0 ? EXIT_STOPPED : EXIT_OK
}

async function runJobs(
  cli: FetchCli,
  toRun: Array<Extract<Fetched, { file: string }>>,
  ends: Map<string, ProjectEnd>,
  opts: {
    review: boolean
    locale: string
    batchSize: number
    parallel: number
    draftEngine: ReturnType<typeof parseDraftEngine>
    secrets: ReturnType<typeof loadSecrets>
    flags: FetchFlags
  },
): Promise<void> {
  const control: RunControl = createRunControl()
  const unwatchKeys = watchKeys(cli.stdin, control, {
    onInterrupt: () => {
      unwatchKeys()
      process.kill(process.pid, 'SIGINT')
    },
  })
  const unsubscribe = control.subscribe((state: RunState) => {
    if (state === 'paused') cli.err('Pausing every running project after its current batch. Press p to resume.')
    if (state === 'running') cli.err('Resumed.')
    if (state === 'stopping') cli.err('Stopping after the current batches. Projects not started yet will not start.')
  })
  // Translate's review pass and a review both run the configured provider, so
  // the override is resolved for that one, the same way the CLI does it.
  const bin = agentBinOverride(cli.config().reviewProvider, process.env)
  const inputOf = new Map(toRun.map((f) => [f.file, f.input]))
  const kept = new Set(toRun.filter((f) => f.state === 'kept').map((f) => f.file))
  let finished = 0

  try {
    const outcomes = await withSharedDbs(({ db, jobsDb }) =>
      runProjects<BatchSummary>(
        toRun.map((f) => f.file),
        {
          parallel: opts.parallel,
          control,
          run: (file, control) =>
            opts.review
              ? cli.reviewFile({
                  control,
                  db,
                  jobsDb,
                  file,
                  locale: opts.locale,
                  batchSize: opts.batchSize,
                  ...(opts.flags.ai === false ? { noAi: true } : {}),
                  ...(opts.flags.fresh ? { fresh: true } : {}),
                  bin,
                })
              : cli.translate({
                  control,
                  db,
                  jobsDb,
                  file,
                  locale: opts.locale,
                  mode: 'pending',
                  draftEngine: opts.draftEngine,
                  batchSize: opts.batchSize,
                  ...(opts.flags.fresh ? { fresh: true } : {}),
                  secrets: opts.secrets,
                  bin,
                }),
          onEvent: (e) => {
            if (e.type === 'project-start') {
              const note = kept.has(e.file) ? ' (existing file kept)' : ''
              cli.err(`Started ${inputOf.get(e.file)}${note}`)
            } else {
              finished += 1
              cli.err(`[${finished}/${toRun.length}] ${inputOf.get(e.outcome.file)}: ${tallyCell(cli.ui.err, e.outcome.state)}`)
            }
          },
        },
      ),
    )
    const username = cli.config().wporgUsername
    for (const outcome of outcomes) ends.set(inputOf.get(outcome.file)!, endOfJob(outcome, username))
  } finally {
    unsubscribe()
    unwatchKeys()
  }
}
