import type Database from 'better-sqlite3'
import { chunk } from '../batch.js'
import type { RunControl } from '../run-control.js'
import { loadConfig, loadSecrets } from '../config.js'
import { DraftQuotaError, DraftRateLimitError, getDraftEngine } from '../draft/index.js'
import {
  abandonRun,
  draftHash,
  finishRun,
  getDraft,
  getDraftVerdict,
  openJobsDb,
  pruneStaleConfigs,
  putDraft,
  putDraftVerdict,
  draftSrcHash,
  recordEntries,
  startRun,
  translateConfigHash,
  type DraftReview,
} from '../jobs/index.js'
import { MCP_ENV, writeMcpConfig } from '../mcp/config.js'
import { loadPo, type ApplyResult, type PoFile } from '../po/po-file.js'
import { reviewBatch } from '../review/claude-review.js'
import { findExactTm, openDb } from '../storage/index.js'
import { normalizeLocale } from '../tmx/parse.js'
import type { DraftEngine, Locale, ReviewInput, ReviewResult, Secrets, TranslationUnit } from '../types.js'

export type TranslateEvent =
  | { type: 'start'; file: string; total: number; pending: number }
  | { type: 'tm-hit'; count: number }
  // `at` on the batch boundaries is what the remaining-time estimate is built
  // from; see the review events, which carry it for the same reason.
  | { type: 'batch-start'; index: number; of: number; size: number; at: number }
  // Emitted between the two long calls in a batch. The bar cannot move inside a
  // batch, so this and the elapsed clock are the only signs the run is alive.
  | { type: 'batch-phase'; index: number; phase: 'drafting' | 'reviewing'; at: number }
  | { type: 'batch-done'; index: number; translated: number; fuzzy: number; at: number }
  | { type: 'batch-skipped'; index: number; size: number; reason: string; at: number }
  | { type: 'warning'; message: string }
  | { type: 'saved' }
  | { type: 'paused'; at: number }
  | { type: 'resumed'; at: number }
  | { type: 'done'; summary: TranslateSummary }

export interface TranslateSummary {
  file: string
  total: number
  pending: number
  fromTm: number
  translated: number
  fuzzy: number
  skipped: number
  stopped?: string
}

export interface TranslateOptions {
  file: string
  locale: Locale
  mode: 'pending' | 'all'
  draftEngine: 'deepl' | 'openai'
  dryRun?: boolean
  batchSize?: number
  model?: string
  // Lets the caller park the run between batches, or end it early.
  control?: RunControl
  db?: Database.Database
  jobsDb?: Database.Database
  secrets?: Secrets
  engine?: DraftEngine
  review?: typeof reviewBatch
  mcpConfigPath?: string
  claudeBin?: string
  onProgress?: (e: TranslateEvent) => void
}

type Emit = (e: TranslateEvent) => void

// The draft engines raise a typed quota error, but the claude review step just
// fails, and a run that keeps going past an exhausted subscription spends two
// process spawns per batch to learn the same thing again.
const MAX_CONSECUTIVE_SKIPS = 3

function isStopError(err: unknown): err is DraftQuotaError | DraftRateLimitError {
  return err instanceof DraftQuotaError || err instanceof DraftRateLimitError
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function resolveBatchSize(requested: number | undefined): number {
  const size = requested ?? loadConfig().batchSize
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`batch size must be a positive integer, got ${size}`)
  }
  return size
}

// A TM row per msgid/msgidPlural only maps onto exactly two plural forms; other counts go through the engine.
function tmLookup(db: Database.Database, unit: TranslationUnit, locale: Locale, nplurals: number): ApplyResult | undefined {
  const singular = findExactTm(db, unit.msgid, locale, unit.msgctxt)
  if (!singular) return undefined
  if (unit.msgidPlural === undefined) return { key: unit.key, text: [singular.target], fuzzy: false }
  if (nplurals !== 2) return undefined
  const plural = findExactTm(db, unit.msgidPlural, locale, unit.msgctxt)
  if (!plural) return undefined
  return { key: unit.key, text: [singular.target, plural.target], fuzzy: false }
}

async function persist(po: PoFile, results: ApplyResult[], dryRun: boolean | undefined): Promise<boolean> {
  po.apply(results)
  if (dryRun) return false
  await po.save()
  return true
}

type Drafts = Map<string, string[]>

async function draft(
  units: TranslationUnit[],
  engine: DraftEngine,
  locale: Locale,
  nplurals: number,
  cache?: { get: (u: TranslationUnit) => string[] | undefined; put: (u: TranslationUnit, text: string[]) => void },
): Promise<Drafts> {
  const drafts: Drafts = new Map()
  const missing: TranslationUnit[] = []
  for (const unit of units) {
    const hit = cache?.get(unit)
    if (hit) drafts.set(unit.key, hit)
    else missing.push(unit)
  }
  if (missing.length > 0) {
    for (const d of await engine.translate(missing, locale, nplurals)) {
      drafts.set(d.key, d.drafts)
      const unit = missing.find((u) => u.key === d.key)
      if (unit) cache?.put(unit, d.drafts)
    }
  }
  const absent = units.filter((u) => !drafts.has(u.key)).map((u) => JSON.stringify(u.key))
  if (absent.length > 0) throw new Error(`${engine.name}: no draft returned for ${absent.join(', ')}`)
  return drafts
}

interface ReviewCache {
  get: (unit: TranslationUnit, drafts: string[]) => DraftReview | undefined
  put: (unit: TranslationUnit, drafts: string[], review: DraftReview) => void
}

async function reviewDrafts(
  units: TranslationUnit[],
  drafts: Drafts,
  review: typeof reviewBatch,
  opts: TranslateOptions,
  locale: Locale,
  nplurals: number,
  mcpConfigPath: string,
  cache?: ReviewCache,
): Promise<ReviewResult[]> {
  const byKey = new Map(units.map((u) => [u.key, u]))
  const inputs: ReviewInput[] = units.map((u) => ({
    key: u.key,
    msgid: u.msgid,
    ...(u.msgctxt !== undefined ? { msgctxt: u.msgctxt } : {}),
    ...(u.msgidPlural !== undefined ? { msgidPlural: u.msgidPlural } : {}),
    comments: u.comments,
    drafts: drafts.get(u.key) ?? [],
  }))

  const cached: ReviewResult[] = []
  const missing: ReviewInput[] = []
  for (const input of inputs) {
    const unit = byKey.get(input.key)
    const hit = unit && cache?.get(unit, input.drafts)
    if (hit) cached.push({ key: input.key, text: hit.text, fuzzy: hit.fuzzy, reason: hit.reason })
    else missing.push(input)
  }

  const fresh =
    missing.length > 0
      ? await review(missing, {
          locale,
          nplurals,
          mcpConfigPath,
          ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        })
      : []

  for (const result of fresh) {
    const unit = byKey.get(result.key)
    if (unit) {
      cache?.put(unit, drafts.get(result.key) ?? [], {
        text: result.text,
        fuzzy: result.fuzzy,
        reason: result.reason,
      })
    }
  }

  const allowed = new Set(units.map((u) => u.key))
  return [...cached, ...fresh].filter((r) => allowed.has(r.key))
}

export async function translateFile(opts: TranslateOptions): Promise<TranslateSummary> {
  const emit: Emit = opts.onProgress ?? (() => undefined)
  const batchSize = resolveBatchSize(opts.batchSize)
  const locale = normalizeLocale(opts.locale)
  const po = await loadPo(opts.file)
  const units = po.units(opts.mode)
  const summary: TranslateSummary = {
    file: opts.file,
    total: po.units('all').length,
    pending: units.length,
    fromTm: 0,
    translated: 0,
    fuzzy: 0,
    skipped: 0,
  }
  emit({ type: 'start', file: opts.file, total: summary.total, pending: summary.pending })

  const ownsDb = opts.db === undefined
  const db = opts.db ?? openDb()
  const jobs = opts.jobsDb ?? openJobsDb()
  const ownsJobsDb = opts.jobsDb === undefined
  // Everything below opens a run in `jobs` and does real work against it, so
  // from here on a throw — a caller's onProgress blowing up, a batch that
  // could not even produce a draft — must not leak the handle this call
  // opened, nor leave history claiming the run is still going.
  let runId: number | undefined
  try {
    // Translate runs no rules and its prompt inlines no glossary, so the only
    // thing that can invalidate a draft review is the prompt itself.
    const config = translateConfigHash(locale)
    pruneStaleConfigs(jobs, 'draft_verdict', locale, config)

    // What the draft prompt shows the engine, and nothing it does not: the
    // comments are handed over as disambiguation hints and the plural count
    // decides how many drafts are asked for, so a draft formed under one of
    // them must not be served under another. References are absent because the
    // draft prompt does not carry them.
    const unitHash = (unit: TranslationUnit): string =>
      draftSrcHash(
        {
          msgid: unit.msgid,
          ...(unit.msgctxt !== undefined ? { msgctxt: unit.msgctxt } : {}),
          ...(unit.msgidPlural !== undefined ? { msgidPlural: unit.msgidPlural } : {}),
          // Keyed by the source alone: an entry is drafted because it has no
          // translation yet, so including msgstr would key every row on the
          // empty string it is about to stop being.
          msgstr: [],
        },
        { comments: unit.comments, nplurals: po.nplurals },
      )

    const engineName = opts.engine?.name ?? opts.draftEngine
    const draftCache = {
      get: (unit: TranslationUnit) => getDraft(jobs, { srcHash: unitHash(unit), locale, engine: engineName }),
      put: (unit: TranslationUnit, text: string[]) =>
        putDraft(jobs, { srcHash: unitHash(unit), locale, engine: engineName }, text),
    }
    const reviewCache: ReviewCache = {
      get: (unit, text) =>
        getDraftVerdict(jobs, {
          srcHash: unitHash(unit),
          draftHash: draftHash(text),
          configHash: config,
          locale,
          engine: 'claude',
        }),
      put: (unit, text, value) =>
        putDraftVerdict(
          jobs,
          { srcHash: unitHash(unit), draftHash: draftHash(text), configHash: config, locale, engine: 'claude' },
          value,
        ),
    }

    runId = startRun(jobs, {
      file: opts.file,
      ...(po.headers['Project-Id-Version'] ? { project: po.headers['Project-Id-Version'] } : {}),
      command: 'translate',
      locale,
      nplurals: po.nplurals,
      batchSize,
      engine: engineName,
    })
    recordEntries(
      jobs,
      runId,
      units.map((u) => u.key),
    )

    const hits: ApplyResult[] = []
    const rest: TranslationUnit[] = []
    for (const unit of units) {
      const hit = tmLookup(db, unit, locale, po.nplurals)
      if (hit) hits.push(hit)
      else rest.push(unit)
    }
    const savedHits = hits.length > 0 && (await persist(po, hits, opts.dryRun))
    summary.fromTm = hits.length
    emit({ type: 'tm-hit', count: hits.length })
    if (savedHits) emit({ type: 'saved' })

    const batches = chunk(rest, batchSize)
    if (batches.length > 0) {
      const engine =
        opts.engine ??
        getDraftEngine(opts.draftEngine, opts.secrets ?? loadSecrets(), {
          onWarning: (message) => emit({ type: 'warning', message }),
        })
      const review = opts.review ?? reviewBatch
      const mcpConfigPath = opts.mcpConfigPath ?? (await writeMcpConfig({ env: { [MCP_ENV.locale]: locale } }))

      let consecutiveSkips = 0

      batchLoop: for (const [i, batch] of batches.entries()) {
        // Between batches, never inside one: the batch in flight has already been
        // paid for, so it finishes and saves before anything parks.
        if (opts.control && (await opts.control.gate()) === 'stop') {
          summary.stopped = 'stopped before batch ' + String(i + 1)
          break batchLoop
        }
        const index = i + 1
        emit({ type: 'batch-start', index, of: batches.length, size: batch.length, at: Date.now() })
        emit({ type: 'batch-phase', index, phase: 'drafting', at: Date.now() })

        let drafts: Drafts | undefined
        let results: ReviewResult[] | undefined
        let lastError: unknown
        for (let attempt = 0; attempt < 2 && results === undefined; attempt++) {
          try {
            drafts ??= await draft(batch, engine, locale, po.nplurals, draftCache)
            emit({ type: 'batch-phase', index, phase: 'reviewing', at: Date.now() })
            results = await reviewDrafts(batch, drafts, review, opts, locale, po.nplurals, mcpConfigPath, reviewCache)
          } catch (err) {
            if (isStopError(err)) {
              summary.stopped = err.message
              break batchLoop
            }
            lastError = err
          }
        }

        if (results === undefined) {
          summary.skipped += batch.length
          emit({ type: 'batch-skipped', index, size: batch.length, reason: errorMessage(lastError), at: Date.now() })
          if (++consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
            summary.stopped = `${consecutiveSkips} batches failed in a row: ${errorMessage(lastError)}`
            break batchLoop
          }
          continue
        }
        consecutiveSkips = 0

        const saved = await persist(po, results, opts.dryRun)
        const fuzzy = results.filter((r) => r.fuzzy).length
        summary.translated += results.length
        summary.fuzzy += fuzzy
        emit({ type: 'batch-done', index, translated: results.length, fuzzy, at: Date.now() })
        if (saved) emit({ type: 'saved' })
      }
    }

    // Written once, from the same numbers the caller is about to be handed, so
    // the history and the report cannot disagree. A run stopped part way is
    // abandoned rather than marked done: it has no totals worth freezing.
    if (summary.stopped !== undefined) {
      abandonRun(jobs, runId)
    } else {
      finishRun(jobs, runId, {
        entries: summary.total,
        flagged: summary.fuzzy,
        repaired: summary.translated,
        unreviewed: 0,
        approvable: summary.translated - summary.fuzzy,
        byCategory: {},
      })
    }
  } catch (err) {
    // A run in progress when this throws is neither done nor still running:
    // mark it stopped so history does not claim otherwise, before the handle
    // it needs to do that is closed underneath it.
    if (runId !== undefined) abandonRun(jobs, runId)
    throw err
  } finally {
    if (ownsDb) db.close()
    if (ownsJobsDb) jobs.close()
  }

  // Outside the try on purpose: by here the run's history is settled, and a
  // caller whose progress handler throws must not be able to rewrite it. A
  // failed notification is not a failed translation.
  emit({ type: 'done', summary })
  return summary
}
