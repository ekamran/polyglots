import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ClaudeRunOptions } from '../claude/run.js'
import {
  auditEntries,
  DEFAULT_BATCH_SIZE,
  type Adjudicator,
  type Verdict,
  type VerdictCache,
} from '../audit/audit.js'
import { encodeMarker, fingerprintReview, MARKER_HEADER, type ReviewMarker } from '../audit/resume.js'
import {
  abandonRun,
  configHash as computeConfigHash,
  finishRun,
  getAuditVerdict,
  openJobsDb,
  pruneStaleConfigs,
  putAuditVerdict,
  recordEntries,
  startRun,
} from '../jobs/index.js'
import { writeMcpConfig, MCP_ENV } from '../mcp/config.js'
import { loadPo, type Annotation } from '../po/po-file.js'
import type { RunControl } from '../run-control.js'
import { loadConfig } from '../config.js'
import { allGlossary, openDb } from '../storage/index.js'
import type { AuditEntry, Locale, ReviewEvent, ReviewSummary } from '../types.js'

export interface ReviewOptions extends Partial<ClaudeRunOptions> {
  file: string
  locale: Locale
  outDir?: string
  noAi?: boolean
  batchSize?: number
  properNouns?: string[]
  // Ignore an unfinished review left in the problems file and start over.
  fresh?: boolean
  // Lets the caller park the run between batches, or end it early and come back.
  control?: RunControl
  db?: Database.Database
  jobsDb?: Database.Database
  adjudicate?: Adjudicator
  onProgress?: (event: ReviewEvent) => void
}

function outputPath(file: string, opts: { outDir?: string; noAi?: boolean }): string {
  const dir = opts.outDir ?? dirname(file)
  // The name says whether a model was in the loop, because that decides whether
  // anything beyond mechanical whitespace could have been repaired.
  const suffix = opts.noAi ? 'problems' : 'repaired'
  return join(dir, `${basename(file, extname(file))}-${suffix}.po`)
}

function readGlossary(locale: Locale, injected?: Database.Database) {
  if (injected) return allGlossary(injected, locale)
  const db = openDb()
  try {
    return allGlossary(db, locale)
  } finally {
    db.close()
  }
}

function submitted(entry: AuditEntry): boolean {
  return entry.msgstr.some((s) => s !== '')
}

function tally(verdicts: Verdict[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const verdict of verdicts) {
    if (!verdict.problem && !verdict.needsReview) continue
    for (const rule of new Set(verdict.findings.map((f) => f.rule))) {
      counts[rule] = (counts[rule] ?? 0) + 1
    }
  }
  return counts
}

function addTally(into: Record<string, number>, from: Record<string, number>): Record<string, number> {
  for (const [rule, n] of Object.entries(from)) into[rule] = (into[rule] ?? 0) + n
  return into
}

// Names the locale team maintains in config.json, keyed by language subtag so a
// regional locale (pt-br) still picks up the language's list.
function configuredProperNouns(locale: Locale): string[] {
  let all: Record<string, string[]>
  try {
    all = loadConfig().properNouns
  } catch {
    return []
  }
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? locale
  return [...(all[locale] ?? []), ...(language === locale ? [] : (all[language] ?? []))]
}

export async function reviewFile(opts: ReviewOptions): Promise<ReviewSummary> {
  const glossary = readGlossary(opts.locale, opts.db)
  if (glossary.length === 0) {
    throw new Error(
      `No cached glossary for locale "${opts.locale}"; run: polyglots glossary sync --locale ${opts.locale}`,
    )
  }

  const source = await readFile(opts.file, 'utf8')
  const po = await loadPo(opts.file)
  const all = po.auditEntries()
  const reviewable = all.filter(submitted)
  const emit = opts.onProgress ?? (() => {})

  const target = outputPath(opts.file, opts)
  const properNouns = opts.properNouns ?? configuredProperNouns(opts.locale)
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE

  const fingerprint = fingerprintReview({
    source,
    locale: opts.locale,
    batchSize,
    noAi: opts.noAi === true,
    glossary,
    properNouns,
  })

  // An unfinished review used to be recovered from a marker in the output
  // file's header, with the flagged entries read back out of the file itself.
  // Both are gone: what a previous run decided is in the job store, keyed by
  // what it looked at, so resuming is just a cache that already has most of
  // its answers. A marker written by 0.2.0 through 0.4.0 is ignored, and the
  // run starts over, exactly as the FORMAT=2 bump did in 0.3.0.
  const jobs = opts.jobsDb ?? openJobsDb()
  const ownsJobsDb = opts.jobsDb === undefined
  // Everything below opens a run in `jobs` and does real work against it, so
  // from here on a throw — a caller's onProgress blowing up, a batch that
  // could not even produce an unreviewed verdict — must not leak the handle
  // this call opened, nor leave history claiming the run is still going.
  let runId: number | undefined
  let summary: ReviewSummary
  try {
    const config = computeConfigHash({ locale: opts.locale, glossary, properNouns })
    // The cache holds verdicts for the current configuration and nothing else.
    pruneStaleConfigs(jobs, 'audit_verdict', opts.locale, config)

    // --no-ai reaches no model, so there is nothing to cache and nothing to reuse.
    const store: VerdictCache | undefined = opts.noAi
      ? undefined
      : {
          get: (key) => (opts.fresh ? undefined : getAuditVerdict(jobs, key)),
          put: (key, verdict) => putAuditVerdict(jobs, key, verdict),
        }

    runId = startRun(jobs, {
      file: opts.file,
      ...(po.headers['Project-Id-Version'] ? { project: po.headers['Project-Id-Version'] } : {}),
      command: 'review',
      locale: opts.locale,
      nplurals: po.nplurals,
      batchSize,
      engine: 'claude',
    })
    recordEntries(
      jobs,
      runId,
      reviewable.map((e) => e.key),
    )

    emit({
      type: 'start',
      file: opts.file,
      total: all.length,
      reviewable: reviewable.length,
    })

    const mcpConfigPath =
      opts.mcpConfigPath ?? (opts.noAi ? '' : await writeMcpConfig({ env: { [MCP_ENV.locale]: opts.locale } }))

    const marker: ReviewMarker = {
      fingerprint,
      done: 0,
      of: 0,
      problems: 0,
      unreviewed: 0,
      repaired: 0,
      byRule: {},
    }

    // A large submission is hundreds of batches and hours of wall clock, so the file
    // is rewritten after every one, marker and all. Losing it to a Ctrl+C is not
    // acceptable, and re-parsing the source each time is cheaper than the AI call
    // that preceded it.
    const decided: Verdict[] = []
    // Entries in batches the run never reached. Reported by auditEntries rather
    // than derived here, so a stopped run cannot mis-state what it looked at.
    let pending = 0
    let wrote = false
    const persist = async (): Promise<number> => {
      const annotations = new Map<string, Annotation>()
      for (const verdict of decided) {
        // A repair with nothing else wrong is neither a problem nor a guess, and it
        // still belongs in the file: it is the only copy of the correction.
        if (!verdict.problem && !verdict.needsReview && verdict.text === undefined) continue
        const notes = verdict.findings.map((f) => f.message)
        annotations.set(verdict.key, {
          // A verdict with no findings still has to say something: keepOnly would
          // otherwise fall back to a generic note, and the model's own reason is
          // the better line to give the human reading the file.
          notes: notes.length > 0 ? notes : [verdict.reason],
          ...(verdict.text === undefined ? {} : { text: verdict.text }),
        })
      }
      if (opts.outDir) await mkdir(opts.outDir, { recursive: true })
      const out = await loadPo(opts.file)
      out.keepOnly(annotations)
      out.setHeader(MARKER_HEADER, encodeMarker(marker))
      await out.save(target)
      // A file holding nothing but the marker is bookkeeping, not a result, so it
      // is not announced.
      if (!wrote && annotations.size > 0) {
        wrote = true
        emit({ type: 'written', file: target })
      }
      return annotations.size
    }

    const verdicts = await auditEntries({
      entries: reviewable,
      locale: opts.locale,
      nplurals: po.nplurals,
      glossary,
      properNouns,
      mcpConfigPath,
      batchSize,
      engine: 'claude',
      configHash: config,
      ...(opts.noAi === undefined ? {} : { noAi: opts.noAi }),
      ...(store ? { store } : {}),
      ...(opts.control ? { control: opts.control } : {}),
      onStopped: (info) => {
        pending = info.pending
        // Rewind past a failed streak so the next run re-attempts those batches
        // instead of trusting entries that only got flagged because the model
        // could not be reached.
        marker.done = Math.min(marker.done, info.lastGood)
      },
      ...(opts.adjudicate ? { adjudicate: opts.adjudicate } : {}),
      ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      onRules: (r) => emit({ type: 'rules-done', flagged: r.flagged, suspects: r.suspects }),
      onBatchStart: (b) => emit({ type: 'batch-start', index: b.index, of: b.of, size: b.size, at: Date.now() }),
      // Entries an earlier run already judged. They belong in the output file
      // from the first write, not only in the last one, or a run interrupted
      // part way through a resume would write a file that had lost them.
      onCached: async (cached) => {
        decided.push(...cached)
        await persist()
      },
      onBatch: async (b) => {
        decided.push(...b.verdicts)
        marker.done = b.index
        marker.of = b.of
        marker.problems += b.verdicts.filter((v) => v.problem).length
        marker.unreviewed += b.verdicts.filter((v) => v.unreviewed).length
        marker.repaired += b.verdicts.filter((v) => v.text !== undefined).length
        addTally(marker.byRule, tally(b.verdicts))
        await persist()
        // One terminal event per batch: the reducer counts either as progress, so
        // emitting both would advance the bar twice.
        if (b.failed) emit({ type: 'batch-failed', index: b.index, size: b.size, reason: b.failed, at: Date.now() })
        else emit({ type: 'batch-done', index: b.index, problems: b.problems, at: Date.now() })
      },
    })

    const problems = verdicts.filter((v) => v.problem)
    // Set only when the run was stopped part way, by auditEntries, which is the
    // only thing that knows exactly which batches it never reached.

    const needsReview = verdicts.filter((v) => v.needsReview)

    // The marker is accumulated per batch so a Ctrl+C between batches leaves a
    // usable one, but these are the authority at the end: a run that dropped an
    // untrusted tail must not leave those counts behind in the header. The summary
    // then reads the same numbers, so the file and the report cannot disagree.
    marker.problems = problems.length
    marker.unreviewed = verdicts.filter((v) => v.unreviewed).length
    marker.repaired = verdicts.filter((v) => v.text !== undefined).length
    marker.byRule = tally(verdicts)

    // The rules-only path decides everything up front, so nothing was persisted yet.
    decided.length = 0
    decided.push(...verdicts)
    const written = await persist()

    summary = {
      file: opts.file,
      total: all.length,
      skipped: all.length - reviewable.length,
      reviewed: reviewable.length,
      problems: marker.problems,
      needsReview: needsReview.length,
      approvable: reviewable.length - problems.length - needsReview.length - pending,
      pending,
      unreviewed: marker.unreviewed,
      repaired: marker.repaired,
      written,
      byRule: marker.byRule,
    }

    if (written > 0) summary.problemsFile = target
    // Nothing was flagged, so the only thing left in the file is the marker. A
    // finished review has nothing to resume, so the file goes. A run that was
    // stopped part way keeps it: the marker is the only record of where to pick up,
    // and deleting it would silently turn a pause into a restart.
    else if (pending === 0) await rm(target, { force: true })

    // Written once, from the same numbers the caller is about to be given, so the
    // history and the report cannot disagree. A run stopped part way is abandoned
    // rather than marked done: it has no totals worth freezing, and abandoning it
    // also drops the scratch entry rows nothing will read again.
    if (pending > 0) abandonRun(jobs, runId)
    else {
      finishRun(jobs, runId, {
        entries: summary.reviewed,
        flagged: summary.problems,
        repaired: summary.repaired,
        unreviewed: summary.unreviewed,
        approvable: summary.approvable,
        byCategory: summary.byRule,
      })
    }
  } catch (err) {
    // A run in progress when this throws is neither done nor still running: mark
    // it stopped so history does not claim otherwise, before the handle it needs
    // to do that is closed underneath it.
    if (runId !== undefined) abandonRun(jobs, runId)
    throw err
  } finally {
    if (ownsJobsDb) jobs.close()
  }

  // Outside the try on purpose: by here the run's history is settled, and a
  // caller whose progress handler throws must not be able to rewrite it. A
  // failed notification is not a failed review.
  emit({ type: 'done', summary })
  return summary
}
