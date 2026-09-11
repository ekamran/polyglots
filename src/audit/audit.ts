import { chunk } from '../batch.js'
import { runClaude, type ClaudeRunOptions } from '../claude/run.js'
import type { AuditEntry, Finding, GlossaryEntry, Locale } from '../types.js'
import { buildAuditPrompt, type AuditCandidate } from './prompt.js'
import { auditBatchJsonSchema, mapAuditResults, type AuditResult } from './schema.js'
import { buildRuleContext, runRules } from './rules/index.js'

export interface Verdict {
  key: string
  problem: boolean
  findings: Finding[]
  reason: string
  unreviewed?: boolean
  needsReview?: boolean
}

export type Adjudicator = (
  batch: AuditCandidate[],
  opts: { locale: Locale; nplurals: number } & ClaudeRunOptions,
) => Promise<AuditResult[]>

export interface BatchStart {
  index: number
  of: number
  size: number
}

export interface BatchProgress extends BatchStart {
  problems: number
  // The verdicts this batch decided, so a caller can persist as it goes rather
  // than holding hours of work in memory until the run ends.
  verdicts: Verdict[]
  // Set when the batch could not be adjudicated and its entries were marked
  // unreviewed.
  failed?: string
}

export interface AuditOptions extends Partial<ClaudeRunOptions> {
  entries: AuditEntry[]
  locale: Locale
  nplurals: number
  glossary: GlossaryEntry[]
  properNouns?: string[]
  noAi?: boolean
  batchSize?: number
  adjudicate?: Adjudicator
  onRules?: (summary: { flagged: number; suspects: number }) => void
  onBatchStart?: (batch: BatchStart) => void
  // Awaited, so a caller writing to disk finishes before the next batch starts.
  onBatch?: (progress: BatchProgress) => void | Promise<void>
}

const DEFAULT_BATCH_SIZE = 25

export const adjudicateWithClaude: Adjudicator = async (batch, opts) => {
  const payload = await runClaude(buildAuditPrompt(batch, opts.locale, opts.nplurals), auditBatchJsonSchema, opts)
  return mapAuditResults(batch, payload)
}

function ruleReason(findings: Finding[]): string {
  return findings.map((f) => f.message).join('; ')
}

export async function auditEntries(opts: AuditOptions): Promise<Verdict[]> {
  const ctx = buildRuleContext({
    locale: opts.locale,
    glossary: opts.glossary,
    nplurals: opts.nplurals,
    entries: opts.entries,
    ...(opts.properNouns ? { properNouns: opts.properNouns } : {}),
  })

  const verdicts = new Map<string, Verdict>()
  const candidates: AuditCandidate[] = []

  for (const entry of opts.entries) {
    const findings = runRules(entry, ctx)
    const errors = findings.filter((f) => f.severity === 'error')

    if (errors.length > 0) {
      verdicts.set(entry.key, { key: entry.key, problem: true, findings, reason: ruleReason(findings) })
      continue
    }
    if (opts.noAi) {
      // Nothing adjudicates a suspect without the model, so a soft finding is
      // reported for a human to look at rather than asserted as a problem.
      verdicts.set(entry.key, {
        key: entry.key,
        problem: false,
        ...(findings.length > 0 ? { needsReview: true } : {}),
        findings,
        reason: ruleReason(findings),
      })
      continue
    }
    candidates.push({
      id: 0,
      key: entry.key,
      msgid: entry.msgid,
      ...(entry.msgctxt ? { msgctxt: entry.msgctxt } : {}),
      ...(entry.msgidPlural ? { msgidPlural: entry.msgidPlural } : {}),
      msgstr: entry.msgstr,
      comments: entry.comments,
      references: entry.references,
      hints: findings,
    })
  }

  opts.onRules?.({
    flagged: [...verdicts.values()].filter((v) => v.problem).length,
    suspects: candidates.filter((c) => c.hints.length > 0).length,
  })

  const adjudicate = opts.adjudicate ?? adjudicateWithClaude
  const batches = chunk(candidates, opts.batchSize ?? DEFAULT_BATCH_SIZE)

  for (const [i, rawBatch] of batches.entries()) {
    // Ids are per batch and 1-based: the model never has to echo a gettext key,
    // whose msgctxt separator does not survive a JSON schema round-trip.
    const batch = rawBatch.map((c, n) => ({ ...c, id: n + 1 }))
    const position = { index: i + 1, of: batches.length, size: batch.length }
    opts.onBatchStart?.(position)

    const outcome = await runBatch(adjudicate, batch, opts)

    let problems = 0
    const decided: Verdict[] = []
    for (const [n, candidate] of batch.entries()) {
      const verdict = outcome.results ? toVerdict(candidate, outcome.results[n]!) : unreviewed(candidate)
      if (verdict.problem) problems += 1
      verdicts.set(candidate.key, verdict)
      decided.push(verdict)
    }
    await opts.onBatch?.({
      ...position,
      problems,
      verdicts: decided,
      ...(outcome.failed ? { failed: outcome.failed } : {}),
    })
  }

  return opts.entries.map((e) => verdicts.get(e.key)!).filter(Boolean)
}

async function runBatch(
  adjudicate: Adjudicator,
  batch: AuditCandidate[],
  opts: AuditOptions,
): Promise<{ results?: AuditResult[]; failed?: string }> {
  const claudeOpts = {
    locale: opts.locale,
    nplurals: opts.nplurals,
    mcpConfigPath: opts.mcpConfigPath ?? '',
    ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  }
  let failed = 'unknown error'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { results: await adjudicate(batch, claudeOpts) }
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err)
    }
  }
  return { failed }
}

function toVerdict(candidate: AuditCandidate, result: AuditResult): Verdict {
  const aiFindings: Finding[] = result.problem
    ? result.categories.map((category) => ({
        rule: `ai:${category}`,
        severity: 'error' as const,
        message: result.reason,
      }))
    : []
  const findings = result.problem ? [...candidate.hints, ...aiFindings] : []
  return { key: candidate.key, problem: result.problem, findings, reason: result.reason }
}

// A batch we failed to review is never silently approved: a false negative ships a
// bad translation, a false positive costs one retranslation.
function unreviewed(candidate: AuditCandidate): Verdict {
  return {
    key: candidate.key,
    problem: true,
    unreviewed: true,
    findings: [
      ...candidate.hints,
      { rule: 'unreviewed', severity: 'error', message: 'automated review failed for this entry' },
    ],
    reason: 'this entry could not be reviewed automatically and needs a human look',
  }
}
