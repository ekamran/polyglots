import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ClaudeRunOptions } from '../claude/run.js'
import { auditEntries, DEFAULT_BATCH_SIZE, type Adjudicator, type Verdict } from '../audit/audit.js'
import {
  decodeMarker,
  describeMismatch,
  encodeMarker,
  fingerprintReview,
  MARKER_HEADER,
  type ReviewMarker,
} from '../audit/resume.js'
import { writeMcpConfig, MCP_ENV } from '../mcp/config.js'
import { loadPo, type Annotation } from '../po/po-file.js'
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
  db?: Database.Database
  adjudicate?: Adjudicator
  onProgress?: (event: ReviewEvent) => void
}

function problemsPath(file: string, outDir?: string): string {
  const dir = outDir ?? dirname(file)
  return join(dir, `${basename(file, extname(file))}-problems.po`)
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

  const target = problemsPath(opts.file, opts.outDir)
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

  // What an interrupted run left behind: how far it got, and the entries it had
  // flagged. Those entries are only in the problems file, so they are read back
  // and carried into the file this run writes.
  let resumed: ReviewMarker | undefined
  let carried = new Map<string, string[]>()
  if (!opts.fresh) {
    const previous = await loadPo(target).catch(() => undefined)
    const marker = previous && decodeMarker(previous.headers[MARKER_HEADER])
    // A marker that reached the last batch describes a finished review, and
    // running that again means the user wants it done again, not skipped.
    if (marker && marker.done > 0 && marker.done < marker.of) {
      const why = describeMismatch(marker.fingerprint, fingerprint)
      if (why) {
        throw new Error(
          `${target} holds a review that stopped at batch ${marker.done} of ${marker.of}, but ${why}. ` +
            `Start over (--fresh) to review it from the top, or move that file aside.`,
        )
      }
      resumed = marker
      carried = new Map([...previous.carried()].map(([key, entry]) => [key, entry.notes]))
    }
  }

  emit({
    type: 'start',
    file: opts.file,
    total: all.length,
    reviewable: reviewable.length,
    ...(resumed ? { resumed: resumed.done } : {}),
  })

  const mcpConfigPath =
    opts.mcpConfigPath ?? (opts.noAi ? '' : await writeMcpConfig({ env: { [MCP_ENV.locale]: opts.locale } }))

  const marker: ReviewMarker = {
    fingerprint,
    done: resumed?.done ?? 0,
    of: resumed?.of ?? 0,
    problems: resumed?.problems ?? 0,
    unreviewed: resumed?.unreviewed ?? 0,
    byRule: { ...resumed?.byRule },
  }

  // A large submission is hundreds of batches and hours of wall clock, so the file
  // is rewritten after every one, marker and all. Losing it to a Ctrl+C is not
  // acceptable, and re-parsing the source each time is cheaper than the AI call
  // that preceded it.
  const decided: Verdict[] = []
  let wrote = false
  const persist = async (): Promise<number> => {
    const annotations = new Map<string, Annotation>([...carried].map(([key, notes]) => [key, { notes }]))
    for (const verdict of decided) {
      if (!verdict.problem && !verdict.needsReview) continue
      annotations.set(verdict.key, { notes: verdict.findings.map((f) => f.message) })
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
    ...(opts.noAi === undefined ? {} : { noAi: opts.noAi }),
    ...(resumed ? { skipBatches: resumed.done } : {}),
    ...(opts.adjudicate ? { adjudicate: opts.adjudicate } : {}),
    ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    onRules: (r) => emit({ type: 'rules-done', flagged: r.flagged, suspects: r.suspects }),
    onBatchStart: (b) => emit({ type: 'batch-start', index: b.index, of: b.of, size: b.size, at: Date.now() }),
    onBatch: async (b) => {
      decided.push(...b.verdicts)
      marker.done = b.index
      marker.of = b.of
      marker.problems += b.verdicts.filter((v) => v.problem).length
      marker.unreviewed += b.verdicts.filter((v) => v.unreviewed).length
      addTally(marker.byRule, tally(b.verdicts))
      await persist()
      // One terminal event per batch: the reducer counts either as progress, so
      // emitting both would advance the bar twice.
      if (b.failed) emit({ type: 'batch-failed', index: b.index, size: b.size, reason: b.failed, at: Date.now() })
      else emit({ type: 'batch-done', index: b.index, problems: b.problems, at: Date.now() })
    },
  })

  const problems = verdicts.filter((v) => v.problem)
  const needsReview = verdicts.filter((v) => v.needsReview)
  // Counts from the batches this run skipped come off the marker: their entries
  // are in the file but their verdicts were never in memory.
  const before = { problems: resumed?.problems ?? 0, unreviewed: resumed?.unreviewed ?? 0 }

  const summary: ReviewSummary = {
    file: opts.file,
    total: all.length,
    skipped: all.length - reviewable.length,
    reviewed: reviewable.length,
    problems: problems.length + before.problems,
    needsReview: needsReview.length,
    approvable: reviewable.length - problems.length - needsReview.length - before.problems,
    unreviewed: verdicts.filter((v) => v.unreviewed).length + before.unreviewed,
    byRule: addTally(tally(verdicts), resumed?.byRule ?? {}),
  }

  // The rules-only path decides everything up front, so nothing was persisted yet.
  decided.length = 0
  decided.push(...verdicts)
  const kept = await persist()
  if (kept > 0) summary.problemsFile = target
  // Nothing was flagged, so the only thing left in the file is the marker, and a
  // finished review has nothing to resume.
  else await rm(target, { force: true })

  emit({ type: 'done', summary })
  return summary
}
