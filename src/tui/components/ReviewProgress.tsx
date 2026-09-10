import { Box, Text } from 'ink'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { renderBar } from './Progress.js'

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
    failures: [],
    written: [],
  }

  for (const e of events) {
    switch (e.type) {
      case 'start':
        state.started = true
        state.file = e.file
        state.total = e.total
        state.reviewable = e.reviewable
        break
      case 'rules-done':
        state.ruleFlagged = e.flagged
        state.suspects = e.suspects
        state.problems += e.flagged
        break
      case 'batch-start':
        state.batchesTotal = e.of
        break
      case 'batch-done':
        state.batchesDone += 1
        state.problems += e.problems
        break
      case 'batch-failed':
        state.batchesDone += 1
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

  if (state.summary) {
    state.problems = state.summary.problems
    state.unreviewed = state.summary.unreviewed
  }
  return state
}

function ruleBreakdown(byRule: Record<string, number>): string[] {
  return Object.entries(byRule)
    .sort(([, a], [, b]) => b - a)
    .map(([rule, n]) => `${rule} ${n}`)
}

export function ReviewProgress({ events }: { events: ReviewEvent[] }) {
  const state = reduceReviewProgress(events)
  if (!state.started) return <Text dimColor>Starting…</Text>

  const { summary } = state
  const breakdown = summary ? ruleBreakdown(summary.byRule) : []

  return (
    <Box flexDirection="column">
      <Text>
        {renderBar(state.batchesDone, state.batchesTotal)} {state.batchesDone}/{state.batchesTotal} problems{' '}
        {state.problems}
      </Text>
      <Text dimColor>
        {state.file} · {state.total} entries, {state.reviewable} reviewable, {state.ruleFlagged} flagged by rules
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
            Done. {summary.problems} problems, {summary.approvable} approvable, {summary.skipped} not submitted
            {summary.unreviewed > 0 ? `, ${summary.unreviewed} unreviewed` : ''}.
          </Text>
          {summary.needsReview > 0 && (
            <Text color="yellow">
              {summary.needsReview} need your eye; see the report. Re-run without “skip AI checks” to have them
              adjudicated.
            </Text>
          )}
          {breakdown.length > 0 && <Text>{breakdown.join(' · ')}</Text>}
          {summary.problemsFile && <Text>Fix them with: polyglots translate {summary.problemsFile}</Text>}
          {!summary.problemsFile && summary.needsReview === 0 && (
            <Text color="green">Nothing flagged; the whole submission looks approvable.</Text>
          )}
          <Text dimColor>Report: {summary.reportFile}</Text>
        </Box>
      )}
    </Box>
  )
}
