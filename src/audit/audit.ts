import { chunk } from '../batch.js'
import type { RunControl } from '../run-control.js'
import { runClaude, type ClaudeRunOptions } from '../claude/run.js'
import type { AuditEntry, Finding, GlossaryEntry, Locale } from '../types.js'
import { buildAuditPrompt, type AuditCandidate } from './prompt.js'
import { judgeFix, repairMechanically } from './repair.js'
import { auditBatchJsonSchema, mapAuditResults, type AuditResult } from './schema.js'
import { buildRuleContext, runRules, type RuleContext } from './rules/index.js'

export interface Verdict {
  key: string
  problem: boolean
  findings: Finding[]
  reason: string
  unreviewed?: boolean
  needsReview?: boolean
  // The corrected translation, when a repair was made and accepted, and which
  // side made it. The rules repair what is computable; the model repairs the
  // rest.
  text?: string[]
  repairedBy?: 'rules' | 'model'
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
  // Batches a previous run already finished and wrote out. They are not
  // re-adjudicated and their entries are not returned: what they decided lives
  // in the problems file, not in this call.
  skipBatches?: number
  // Lets a caller park or end the run at a batch boundary. A subscription that
  // runs out of quota mid-review wants to stop between calls and come back, not
  // abandon a call it has already paid for.
  control?: RunControl
  adjudicate?: Adjudicator
  onRules?: (summary: { flagged: number; suspects: number }) => void
  onBatchStart?: (batch: BatchStart) => void
  // Awaited, so a caller writing to disk finishes before the next batch starts.
  onBatch?: (progress: BatchProgress) => void | Promise<void>
  // Called once if the run ended early. `lastGood` is the batch to resume after,
  // and `pending` counts every entry from there on, including a failed streak
  // that must be re-attempted rather than trusted. Reported rather than derived,
  // because a caller must never present an entry it did not look at as
  // approvable.
  onStopped?: (info: { pending: number; lastGood: number }) => void
}

export const DEFAULT_BATCH_SIZE = 25

// Each batch already retries once on its own, so this many in a row is six
// failed calls: past any transient blip and into something systemic, almost
// always an exhausted quota. Grinding on from here costs two process spawns per
// remaining batch and flags every entry it touches as needing a human look, for
// a reason that has nothing to do with the translations.
const MAX_CONSECUTIVE_FAILURES = 3

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

  for (const original of opts.entries) {
    // Repair what needs no judgment first, then let the rules judge the result.
    // An entry whose only fault was whitespace comes out clean here and takes
    // the ordinary path, rather than being condemned to a file nobody can fix.
    const repaired = repairMechanically(original)
    const entry = repaired ? { ...original, msgstr: repaired } : original
    const mechanical: Finding[] = repaired
      ? [{ rule: 'repaired', severity: 'suspect', message: 'whitespace restored to match the source' }]
      : []
    const base = repaired ? { text: repaired, repairedBy: 'rules' as const } : {}

    const findings = [...mechanical, ...runRules(entry, ctx)]
    const errors = findings.filter((f) => f.severity === 'error')

    if (errors.length > 0 && opts.noAi) {
      verdicts.set(entry.key, { key: entry.key, problem: true, findings, reason: ruleReason(findings), ...base })
      continue
    }
    if (opts.noAi) {
      // A mechanical repair is a settled fix, not an unadjudicated guess, so it
      // alone must not mark the entry as needing a human decision.
      const undecided = findings.filter((f) => f.rule !== 'repaired')
      verdicts.set(entry.key, {
        key: entry.key,
        problem: false,
        ...(undecided.length > 0 ? { needsReview: true } : {}),
        findings,
        reason: ruleReason(findings),
        ...base,
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
      ...(errors.length > 0 ? { condemned: findings } : {}),
      ...(repaired ? { repaired: { text: repaired, repairedBy: 'rules' as const } } : {}),
    })
  }

  opts.onRules?.({
    flagged: candidates.filter((c) => c.condemned).length + [...verdicts.values()].filter((v) => v.problem).length,
    // A mechanical repair is decided, so an entry whose only hint is that one is
    // nobody's open question and does not belong in the count.
    suspects: candidates.filter((c) => !c.condemned && c.hints.some((f) => f.rule !== 'repaired')).length,
  })

  const adjudicate = opts.adjudicate ?? adjudicateWithClaude
  const batches = chunk(candidates, opts.batchSize ?? DEFAULT_BATCH_SIZE)

  const skipBatches = opts.skipBatches ?? 0
  // 1-based index of the first batch in the current run of failures, so the
  // breaker can rewind past the whole streak rather than just the last one.
  let streakStart = 0
  let consecutiveFailures = 0

  // `at` is the 0-based index of the first batch that should NOT be trusted.
  const stopAfter = (at: number): void => {
    opts.onStopped?.({
      lastGood: at,
      pending: batches.slice(at).reduce((n, batch) => n + batch.length, 0),
    })
  }

  for (const [i, rawBatch] of batches.entries()) {
    if (i < skipBatches) continue
    // Before the batch, never inside it: whatever the previous batch decided has
    // already been persisted by its onBatch, so parking here loses nothing.
    if (opts.control && (await opts.control.gate()) === 'stop') {
      stopAfter(i)
      break
    }
    // Ids are per batch and 1-based: the model never has to echo a gettext key,
    // whose msgctxt separator does not survive a JSON schema round-trip.
    const batch = rawBatch.map((c, n) => ({ ...c, id: n + 1 }))
    const position = { index: i + 1, of: batches.length, size: batch.length }
    opts.onBatchStart?.(position)

    const outcome = await runBatch(adjudicate, batch, opts)

    let problems = 0
    const decided: Verdict[] = []
    for (const [n, candidate] of batch.entries()) {
      const verdict = outcome.results
        ? toVerdict(candidate, outcome.results[n]!, ctx, opts.nplurals)
        : unreviewed(candidate)
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

    if (outcome.failed) {
      if (consecutiveFailures === 0) streakStart = position.index
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopAfter(streakStart - 1)
        break
      }
    } else {
      consecutiveFailures = 0
    }
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

function toVerdict(candidate: AuditCandidate, result: AuditResult, ctx: RuleContext, nplurals: number): Verdict {
  // A rule error is a mechanical fact. The model was asked for a fix, not for a
  // second opinion, so it cannot clear one.
  const problem = candidate.condemned !== undefined || result.problem

  const aiFindings: Finding[] = result.problem
    ? result.categories.map((category) => ({
        rule: `ai:${category}`,
        severity: 'error' as const,
        message: result.reason,
      }))
    : []
  // A cleared entry keeps the note for a repair the rules already made. Nothing
  // else records that the text in the file is not what was submitted, and an
  // entry with no note at all is invisible to a resume, which would revert it.
  const findings = problem ? [...candidate.hints, ...aiFindings] : candidate.hints.filter((f) => f.rule === 'repaired')

  const base: Verdict = { key: candidate.key, problem, findings, reason: result.reason, ...(candidate.repaired ?? {}) }
  if (!problem || !result.fix) return base

  const entry: AuditEntry = {
    key: candidate.key,
    msgid: candidate.msgid,
    ...(candidate.msgctxt ? { msgctxt: candidate.msgctxt } : {}),
    ...(candidate.msgidPlural ? { msgidPlural: candidate.msgidPlural } : {}),
    msgstr: candidate.msgstr,
    comments: candidate.comments,
    references: candidate.references,
    fuzzy: false,
  }
  const verdict = judgeFix({ entry, fix: result.fix, nplurals, ctx })
  if ('accepted' in verdict) return { ...base, text: verdict.accepted, repairedBy: 'model' }
  // Say so rather than dropping it. Silence here looks like the model declined,
  // which is a different thing and hides a real signal about the prompt.
  return { ...base, findings: [...findings, { rule: 'fix-rejected', severity: 'suspect', message: verdict.rejected }] }
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
    ...(candidate.repaired ?? {}),
  }
}
