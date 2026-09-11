import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { renderBar } from './Progress.js'
import { estimateRemainingMs, formatDuration, formatFinishTime } from '../../cli/progress.js'

export interface ReviewProgressState {
  started: boolean
  file?: string
  total: number
  reviewable: number
  ruleFlagged: number
  suspects: number
  problems: number
  unreviewed: number
  batchesDone: number
  batchesTotal: number
  // Batches an interrupted run had already finished. Counted as done so the bar
  // shows where the work actually stands, but never timed: their pace was that
  // run's, not this one's.
  resumed: number
  // A batch has started and not yet finished. The bar cannot move while that is
  // true, so it is what the elapsed clock hangs off.
  inFlight: boolean
  batchIndex: number
  batchDurations: number[]
  remainingMs?: number
  failures: string[]
  written: string[]
  summary?: ReviewSummary
}

export function reduceReviewProgress(events: ReviewEvent[]): ReviewProgressState {
  const state: ReviewProgressState = {
    started: false,
    total: 0,
    reviewable: 0,
    ruleFlagged: 0,
    suspects: 0,
    problems: 0,
    unreviewed: 0,
    batchesDone: 0,
    batchesTotal: 0,
    resumed: 0,
    inFlight: false,
    batchIndex: 0,
    batchDurations: [],
    failures: [],
    written: [],
  }

  // Only set while a batch is open, so a duration is recorded exactly once and a
  // fixture without timestamps records none rather than NaN.
  let openedAt: number | undefined
  // Feeds the default-pace guess that stands in until a batch has been timed.
  let batchSize = 0

  const close = (at: unknown) => {
    if (typeof openedAt === 'number' && typeof at === 'number') state.batchDurations.push(at - openedAt)
    openedAt = undefined
  }

  for (const e of events) {
    switch (e.type) {
      case 'start':
        state.started = true
        state.file = e.file
        state.total = e.total
        state.reviewable = e.reviewable
        state.resumed = e.resumed ?? 0
        state.batchesDone = state.resumed
        break
      case 'rules-done':
        state.ruleFlagged = e.flagged
        state.suspects = e.suspects
        state.problems += e.flagged
        break
      case 'batch-start':
        state.batchesTotal = e.of
        state.batchIndex = e.index
        batchSize = e.size
        state.inFlight = true
        openedAt = typeof e.at === 'number' ? e.at : undefined
        break
      case 'batch-done':
        state.batchesDone += 1
        state.problems += e.problems
        state.inFlight = false
        close(e.at)
        break
      case 'batch-failed':
        state.batchesDone += 1
        state.inFlight = false
        close(e.at)
        state.unreviewed += e.size
        state.failures.push(`Batch ${e.index} failed (${e.size} entries): ${e.reason}`)
        break
      case 'written':
        state.written.push(e.file)
        break
      case 'done':
        state.summary = e.summary
        break
    }
  }

  state.remainingMs = estimateRemainingMs(state.batchDurations, state.batchesTotal - state.batchesDone, batchSize)

  if (state.summary) {
    state.inFlight = false
    state.remainingMs = undefined
    state.problems = state.summary.problems
    state.unreviewed = state.summary.unreviewed
  }
  return state
}

// Seconds since `key` last changed while `active`, re-rendered once a second so
// the number visibly moves during a call that produces no other output.
function useElapsed(active: boolean, key: number): number {
  const [since, setSince] = useState(() => Date.now())
  const [now, setNow] = useState(since)

  useEffect(() => {
    if (!active) return
    const started = Date.now()
    setSince(started)
    setNow(started)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, key])

  return Math.max(0, Math.round((now - since) / 1000))
}

function ruleBreakdown(byRule: Record<string, number>): string[] {
  return Object.entries(byRule)
    .sort(([, a], [, b]) => b - a)
    .map(([rule, n]) => `${rule} ${n}`)
}

export function ReviewProgress({ events }: { events: ReviewEvent[] }) {
  const state = reduceReviewProgress(events)
  const elapsed = useElapsed(state.inFlight, state.batchIndex)
  if (!state.started) return <Text dimColor>Starting…</Text>

  const { summary } = state
  const breakdown = summary ? ruleBreakdown(summary.byRule) : []

  return (
    <Box flexDirection="column">
      {/* The bar already shows the completed fraction, so the text carries one
          counter: which batch is running, or how many are finished. Showing both
          reads as a contradiction (2/8 next to batch 3/8). */}
      <Text>
        {renderBar(state.batchesDone, state.batchesTotal || 1)}{' '}
        {state.inFlight
          ? `batch ${state.batchIndex}/${state.batchesTotal} · reviewing ${elapsed}s`
          : `${state.batchesDone}/${state.batchesTotal} batches`}
        {state.remainingMs === undefined
          ? ''
          : ` · ~${formatDuration(state.remainingMs)} left, done by ${formatFinishTime(state.remainingMs)}`}{' '}
        · problems {state.problems}
      </Text>
      <Text dimColor>
        {state.file} · {state.total} entries, {state.reviewable} reviewable, {state.ruleFlagged} flagged by rules
        {state.resumed > 0 ? `, resuming after ${state.resumed} batch${state.resumed === 1 ? '' : 'es'}` : ''}
      </Text>

      {state.failures.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Not reviewed:</Text>
          {state.failures.map((f, i) => (
            <Text key={i} color="yellow">
              {'  - '}
              {f}
            </Text>
          ))}
        </Box>
      )}

      {summary && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Done. {summary.problems + summary.needsReview} problems, {summary.approvable} approvable,{' '}
            {summary.skipped} not submitted
            {summary.unreviewed > 0 ? `, ${summary.unreviewed} unreviewed` : ''}.
          </Text>
          {summary.needsReview > 0 && (
            <Text color="yellow">
              {summary.needsReview} of those are unadjudicated guesses; re-run without “skip AI checks” to have them
              decided.
            </Text>
          )}
          {breakdown.length > 0 && <Text>{breakdown.join(' · ')}</Text>}
          {summary.problemsFile ? (
            <Text>Fix them with: polyglots translate {summary.problemsFile}</Text>
          ) : (
            <Text color="green">Nothing flagged; the whole submission looks approvable.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}
