import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { buildReport } from '../../review/message.js'
import { copyToClipboard } from '../clipboard.js'
import { openInDefaultApp } from '../open-file.js'
import { renderBar } from './Progress.js'
import { estimateRemainingMs, formatDuration, formatFinishTime } from '../../cli/progress.js'
import { useElapsed } from '../hooks/useElapsed.js'

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
  // Work a previous run did, inherited from the job store before this one
  // started. Counted apart from `batchesDone` so the reducer never has to
  // pretend a batch ran that did not.
  skippedBatches: number
  cachedEntries: number
  // A batch has started and not yet finished. The bar cannot move while that is
  // true, so it is what the elapsed clock hangs off.
  inFlight: boolean
  batchIndex: number
  batchDurations: number[]
  remainingMs?: number
  paused: boolean
  failures: string[]
  written: string[]
  // Set when the output file from a previous run still carried a marker from
  // before resume moved to the job store. Reviewing from the top either way,
  // but the person waiting on this deserves to know that's what's happening.
  markerIgnored?: string
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
    skippedBatches: 0,
    cachedEntries: 0,
    inFlight: false,
    batchIndex: 0,
    batchDurations: [],
    paused: false,
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
        break
      case 'cached':
        state.skippedBatches = e.batches
        state.cachedEntries = e.entries
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
      case 'marker-ignored':
        state.markerIgnored = e.file
        break
      // The clock stops with the run: a parked batch is not a slow one.
      case 'paused':
        state.paused = true
        state.inFlight = false
        break
      case 'resumed':
        state.paused = false
        break
      case 'done':
        state.summary = e.summary
        break
    }
  }

  state.remainingMs = estimateRemainingMs(state.batchDurations, state.batchesTotal - state.batchesDone, batchSize)

  if (state.paused) state.remainingMs = undefined

  if (state.summary) {
    state.inFlight = false
    state.remainingMs = undefined
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

/**
 * Where the bar sits, counting the work a previous run already did.
 *
 * Inherited batches are added to both ends rather than left out, so a resumed
 * run opens part way along a bar the same length a first run would have had.
 * Counting from zero out of what is left is accurate and reads as a restart,
 * which is the whole complaint this answers.
 */
export function barDone(state: ReviewProgressState): number {
  return state.skippedBatches + state.batchesDone
}

export function barTotal(state: ReviewProgressState): number {
  return state.skippedBatches + state.batchesTotal
}

export function ReviewProgress({ events }: { events: ReviewEvent[] }) {
  const state = reduceReviewProgress(events)
  const elapsed = useElapsed(state.inFlight, state.batchIndex)
  const [copied, setCopied] = useState<'yes' | 'no' | undefined>(undefined)
  const [opened, setOpened] = useState(false)
  const report = state.summary === undefined ? undefined : buildReport(state.summary)
  // The repaired file, which is the thing worth opening: the submission itself is
  // unchanged on disk and reviewing it again would show none of this run's work.
  const repairedFile = state.summary?.problemsFile

  // Both only once the run is over. During it the keys belong to pause, resume
  // and stop, and a c or an o that silently did nothing would still have to be
  // explained to whoever pressed it.
  useInput((input) => {
    if (input === 'c' && report !== undefined) setCopied(copyToClipboard(report) ? 'yes' : 'no')
    if (input === 'o' && repairedFile !== undefined) setOpened(openInDefaultApp(repairedFile))
  })

  if (!state.started) return <Text dimColor>Starting…</Text>

  const { summary } = state
  const breakdown = summary ? ruleBreakdown(summary.byRule) : []

  return (
    <Box flexDirection="column">
      {/* The bar already shows the completed fraction, so the text carries one
          counter: which batch is running, or how many are finished. Showing both
          reads as a contradiction (2/8 next to batch 3/8). */}
      <Text>
        {renderBar(barDone(state), barTotal(state) || 1)}{' '}
        {state.paused
          ? `paused after batch ${barDone(state)}/${barTotal(state)}`
          : state.inFlight
            ? `batch ${state.skippedBatches + state.batchIndex}/${barTotal(state)} · reviewing ${elapsed}s`
            : `${barDone(state)}/${barTotal(state)} batches`}
        {state.remainingMs === undefined
          ? ''
          : ` · ~${formatDuration(state.remainingMs)} left, done by ${formatFinishTime(state.remainingMs)}`}{' '}
        · problems {state.problems}
      </Text>
      {/* Both counts, because they mean different things and one of them is
          usually zero. `wrong` is what the rules proved: an error-severity
          finding, whose verdict is settled before any model sees it. `suspect`
          is what they want a second opinion on. The four rules that fire most
          on a Turkish submission are all suspect severity, so showing only the
          first reported "0 flagged by rules" on a file where the rules had
          flagged 5,529 of 9,826 entries. */}
      <Text dimColor>
        {state.file} · {state.total} entries, {state.reviewable} reviewable · rules: {state.ruleFlagged} wrong,{' '}
        {state.suspects} suspect
      </Text>
      {/* Only when something was inherited. A cold run saying "0 already
          judged" would be noise on every first review. */}
      {state.cachedEntries > 0 && (
        <Text color="green">
          Resuming: {state.cachedEntries} already judged, {state.batchesTotal} batches left.
        </Text>
      )}

      {state.markerIgnored && (
        <Text color="yellow">
          Ignoring the unfinished review in {state.markerIgnored}: it was written by an earlier version. Reviewing
          from the top.
        </Text>
      )}

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
          {summary.pending > 0 && (
            <Text color="yellow">
              Stopped early with {summary.pending} entries not reviewed. Run it again to carry on.
            </Text>
          )}
          {summary.repaired > 0 && (
            <Text color="green">
              {summary.repaired} repaired, {summary.written - summary.repaired} left for you.
            </Text>
          )}
          {breakdown.length > 0 && <Text>{breakdown.join(' · ')}</Text>}
          {report && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Message for the requester · c to copy</Text>
              <Text>{report}</Text>
              {copied === 'yes' && <Text color="green">Copied to the clipboard.</Text>}
              {copied === 'no' && (
                <Text color="yellow">Could not reach the clipboard; copy the line above by hand.</Text>
              )}
            </Box>
          )}
          {summary.problemsFile ? (
            <>
              <Text>Wrote {summary.problemsFile}.</Text>
              <Text dimColor>o to open it in PoEdit</Text>
              {opened && <Text color="green">Opening it now.</Text>}
            </>
          ) : (
            summary.pending === 0 && <Text color="green">Nothing flagged; the whole submission looks approvable.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}
