import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ClaudeRunOptions } from '../claude/run.js'
import { auditEntries, type Adjudicator, type Verdict } from '../audit/audit.js'
import { writeMcpConfig, MCP_ENV } from '../mcp/config.js'
import { loadPo } from '../po/po-file.js'
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

  const po = await loadPo(opts.file)
  const all = po.auditEntries()
  const reviewable = all.filter(submitted)
  const emit = opts.onProgress ?? (() => {})
  emit({ type: 'start', file: opts.file, total: all.length, reviewable: reviewable.length })

  const mcpConfigPath =
    opts.mcpConfigPath ?? (opts.noAi ? '' : await writeMcpConfig({ env: { [MCP_ENV.locale]: opts.locale } }))

  const target = problemsPath(opts.file, opts.outDir)

  const properNouns = opts.properNouns ?? configuredProperNouns(opts.locale)

  // A large submission is hundreds of batches and hours of wall clock, so the file
  // is rewritten after every one. Losing it all to a Ctrl+C is not acceptable, and
  // re-parsing the source each time is cheaper than the AI call that preceded it.
  const decided: Verdict[] = []
  let wrote = false
  const persist = async (): Promise<void> => {
    const flagged = decided.filter((v) => v.problem || v.needsReview)
    if (flagged.length === 0) return
    if (opts.outDir) await mkdir(opts.outDir, { recursive: true })
    const out = await loadPo(opts.file)
    out.keepOnly(new Map(flagged.map((v) => [v.key, v.findings.map((f) => f.message)])))
    await out.save(target)
    if (!wrote) {
      wrote = true
      emit({ type: 'written', file: target })
    }
  }

  const verdicts = await auditEntries({
    entries: reviewable,
    locale: opts.locale,
    nplurals: po.nplurals,
    glossary,
    properNouns,
    mcpConfigPath,
    ...(opts.noAi === undefined ? {} : { noAi: opts.noAi }),
    ...(opts.batchSize ? { batchSize: opts.batchSize } : {}),
    ...(opts.adjudicate ? { adjudicate: opts.adjudicate } : {}),
    ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    onRules: (r) => emit({ type: 'rules-done', flagged: r.flagged, suspects: r.suspects }),
    onBatchStart: (b) => emit({ type: 'batch-start', index: b.index, of: b.of, size: b.size, at: Date.now() }),
    onBatch: async (b) => {
      decided.push(...b.verdicts)
      await persist()
      // One terminal event per batch: the reducer counts either as progress, so
      // emitting both would advance the bar twice.
      if (b.failed) emit({ type: 'batch-failed', index: b.index, size: b.size, reason: b.failed, at: Date.now() })
      else emit({ type: 'batch-done', index: b.index, problems: b.problems, at: Date.now() })
    },
  })

  const problems = verdicts.filter((v) => v.problem)
  const needsReview = verdicts.filter((v) => v.needsReview)
  // Both go into the file: every entry now carries its reasons as comments, so an
  // unadjudicated guess is legible as one rather than looking like a hard error.
  const flagged = [...problems, ...needsReview]

  const summary: ReviewSummary = {
    file: opts.file,
    total: all.length,
    skipped: all.length - reviewable.length,
    reviewed: reviewable.length,
    problems: problems.length,
    needsReview: needsReview.length,
    approvable: reviewable.length - problems.length - needsReview.length,
    unreviewed: verdicts.filter((v) => v.unreviewed).length,
    byRule: tally(verdicts),
  }

  // The rules-only path decides everything up front, so nothing was persisted yet.
  decided.length = 0
  decided.push(...verdicts)
  await persist()
  if (flagged.length > 0) summary.problemsFile = target

  emit({ type: 'done', summary })
  return summary
}
