import { mkdir, writeFile } from 'node:fs/promises'
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

function outputPaths(file: string, outDir?: string): { problems: string; report: string } {
  const dir = outDir ?? dirname(file)
  const stem = basename(file, extname(file))
  return { problems: join(dir, `${stem}-problems.po`), report: join(dir, `${stem}-report.md`) }
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

function entrySection(verdict: Verdict, byKey: Map<string, AuditEntry>): string[] {
  const entry = byKey.get(verdict.key)
  if (!entry) return []
  const lines = [`### ${entry.msgid}`]
  if (entry.msgctxt) lines.push(`Context: \`${entry.msgctxt}\``)
  lines.push(`Submitted: ${entry.msgstr.filter(Boolean).join(' / ')}`)
  for (const finding of verdict.findings) lines.push(`- **${finding.rule}**: ${finding.message}`)
  lines.push('')
  return lines
}

function buildReport(
  file: string,
  summary: ReviewSummary,
  problems: Verdict[],
  needsReview: Verdict[],
  byKey: Map<string, AuditEntry>,
): string {
  const lines = [
    `# Translation review: ${basename(file)}`,
    '',
    `- Entries in file: ${summary.total}`,
    `- Not submitted (skipped): ${summary.skipped}`,
    `- Reviewed: ${summary.reviewed}`,
    `- Flagged: ${summary.problems}`,
    `- Approvable: ${summary.approvable}`,
  ]
  if (summary.needsReview > 0) lines.push(`- Needs your eye: ${summary.needsReview}`)
  if (summary.unreviewed > 0) lines.push(`- Could not be reviewed: ${summary.unreviewed}`)
  lines.push('')

  if (problems.length === 0 && needsReview.length === 0) {
    lines.push('Nothing was flagged; the whole submission looks approvable.', '')
    return lines.join('\n')
  }

  lines.push('## Issues by category', '')
  for (const [rule, count] of Object.entries(summary.byRule).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${rule}: ${count}`)
  }
  if (problems.length > 0) {
    lines.push('', '## Flagged entries', '')
    for (const verdict of problems) lines.push(...entrySection(verdict, byKey))
  }

  if (needsReview.length > 0) {
    lines.push(
      '',
      '## Needs your eye',
      '',
      'Checks that could not be decided mechanically. They are NOT in the problems',
      'file: glance at these and fix any that are real, or run again without',
      '`--no-ai` to have them adjudicated.',
      '',
    )
    for (const verdict of needsReview) lines.push(...entrySection(verdict, byKey))
  }
  return lines.join('\n')
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

  const properNouns = opts.properNouns ?? configuredProperNouns(opts.locale)

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
    onBatch: (b) => {
      emit({ type: 'batch-start', index: b.index, of: b.of, size: b.size })
      emit({ type: 'batch-done', index: b.index, problems: b.problems })
    },
  })

  const problems = verdicts.filter((v) => v.problem)
  const needsReview = verdicts.filter((v) => v.needsReview)
  const paths = outputPaths(opts.file, opts.outDir)
  const byKey = new Map(reviewable.map((e) => [e.key, e]))

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
    reportFile: paths.report,
  }

  if (opts.outDir) await mkdir(opts.outDir, { recursive: true })

  if (problems.length > 0) {
    const annotations = new Map(problems.map((v) => [v.key, v.findings.map((f) => f.message)]))
    po.keepOnly(annotations)
    await po.save(paths.problems)
    summary.problemsFile = paths.problems
    emit({ type: 'written', file: paths.problems })
  }

  await writeFile(paths.report, buildReport(opts.file, summary, problems, needsReview, byKey), 'utf8')
  emit({ type: 'written', file: paths.report })
  emit({ type: 'done', summary })
  return summary
}
