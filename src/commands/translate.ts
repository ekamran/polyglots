import type Database from 'better-sqlite3'
import { chunk } from '../batch.js'
import { loadConfig, loadSecrets } from '../config.js'
import { DraftQuotaError, DraftRateLimitError, getDraftEngine } from '../draft/index.js'
import { MCP_ENV, writeMcpConfig } from '../mcp/config.js'
import { loadPo, type ApplyResult, type PoFile } from '../po/po-file.js'
import { reviewBatch } from '../review/claude-review.js'
import { findExactTm, openDb } from '../storage/index.js'
import { normalizeLocale } from '../tmx/parse.js'
import type { DraftEngine, Locale, ReviewInput, ReviewResult, Secrets, TranslationUnit } from '../types.js'

export type TranslateEvent =
  | { type: 'start'; file: string; total: number; pending: number }
  | { type: 'tm-hit'; count: number }
  | { type: 'batch-start'; index: number; of: number; size: number }
  // Emitted between the two long calls in a batch. The bar cannot move inside a
  // batch, so this and the elapsed clock are the only signs the run is alive.
  | { type: 'batch-phase'; index: number; phase: 'drafting' | 'reviewing'; at: number }
  | { type: 'batch-done'; index: number; translated: number; fuzzy: number }
  | { type: 'batch-skipped'; index: number; size: number; reason: string }
  | { type: 'warning'; message: string }
  | { type: 'saved' }
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
  db?: Database.Database
  secrets?: Secrets
  engine?: DraftEngine
  review?: typeof reviewBatch
  mcpConfigPath?: string
  claudeBin?: string
  onProgress?: (e: TranslateEvent) => void
}

type Emit = (e: TranslateEvent) => void

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

async function draft(units: TranslationUnit[], engine: DraftEngine, locale: Locale, nplurals: number): Promise<Drafts> {
  const drafts: Drafts = new Map((await engine.translate(units, locale, nplurals)).map((d) => [d.key, d.drafts]))
  const missing = units.filter((u) => !drafts.has(u.key)).map((u) => JSON.stringify(u.key))
  if (missing.length > 0) throw new Error(`${engine.name}: no draft returned for ${missing.join(', ')}`)
  return drafts
}

async function reviewDrafts(
  units: TranslationUnit[],
  drafts: Drafts,
  review: typeof reviewBatch,
  opts: TranslateOptions,
  locale: Locale,
  nplurals: number,
  mcpConfigPath: string,
): Promise<ReviewResult[]> {
  const inputs: ReviewInput[] = units.map((u) => ({
    key: u.key,
    msgid: u.msgid,
    ...(u.msgctxt !== undefined ? { msgctxt: u.msgctxt } : {}),
    ...(u.msgidPlural !== undefined ? { msgidPlural: u.msgidPlural } : {}),
    comments: u.comments,
    drafts: drafts.get(u.key) ?? [],
  }))
  const results = await review(inputs, {
    locale,
    nplurals,
    mcpConfigPath,
    claudeBin: opts.claudeBin,
    model: opts.model,
  })
  const allowed = new Set(units.map((u) => u.key))
  return results.filter((r) => allowed.has(r.key))
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
  try {
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
    if (batches.length === 0) {
      emit({ type: 'done', summary })
      return summary
    }

    const engine =
      opts.engine ??
      getDraftEngine(opts.draftEngine, opts.secrets ?? loadSecrets(), {
        onWarning: (message) => emit({ type: 'warning', message }),
      })
    const review = opts.review ?? reviewBatch
    const mcpConfigPath = opts.mcpConfigPath ?? (await writeMcpConfig({ env: { [MCP_ENV.locale]: locale } }))

    for (const [i, batch] of batches.entries()) {
      const index = i + 1
      emit({ type: 'batch-start', index, of: batches.length, size: batch.length })
      emit({ type: 'batch-phase', index, phase: 'drafting', at: Date.now() })

      let drafts: Drafts | undefined
      let results: ReviewResult[] | undefined
      let lastError: unknown
      for (let attempt = 0; attempt < 2 && results === undefined; attempt++) {
        try {
          drafts ??= await draft(batch, engine, locale, po.nplurals)
          emit({ type: 'batch-phase', index, phase: 'reviewing', at: Date.now() })
          results = await reviewDrafts(batch, drafts, review, opts, locale, po.nplurals, mcpConfigPath)
        } catch (err) {
          if (isStopError(err)) {
            summary.stopped = err.message
            emit({ type: 'done', summary })
            return summary
          }
          lastError = err
        }
      }

      if (results === undefined) {
        summary.skipped += batch.length
        emit({ type: 'batch-skipped', index, size: batch.length, reason: errorMessage(lastError) })
        continue
      }

      const saved = await persist(po, results, opts.dryRun)
      const fuzzy = results.filter((r) => r.fuzzy).length
      summary.translated += results.length
      summary.fuzzy += fuzzy
      emit({ type: 'batch-done', index, translated: results.length, fuzzy })
      if (saved) emit({ type: 'saved' })
    }

    emit({ type: 'done', summary })
    return summary
  } finally {
    if (ownsDb) db.close()
  }
}
