import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { estimateRemainingMs, formatDuration, formatFinishTime, renderBar as bar, type BatchPhase } from '../../cli/progress.js'
import { useElapsed } from '../hooks/useElapsed.js'
import { openInDefaultApp } from '../open-file.js'
import type { TranslateEvent, TranslateSummary } from '../../commands/translate.js'

export interface ProgressState {
  started: boolean
  file?: string
  total: number
  pending: number
  fromTm: number
  translated: number
  fuzzy: number
  skipped: number
  done: number
  batch?: { index: number; of: number }
  // Which of the batch's two long calls is running, and since when. The bar
  // cannot move inside a batch, so this is what the clock hangs off.
  phase?: { name: BatchPhase; since: number }
  // The bar counts entries, but time is spent in batches, so the estimate is
  // built from those.
  batchDurations: number[]
  batchesDone: number
  remainingMs?: number
  warnings: string[]
  summary?: TranslateSummary
}

export function reduceProgress(events: TranslateEvent[]): ProgressState {
  const state: ProgressState = {
    started: false,
    total: 0,
    pending: 0,
    fromTm: 0,
    translated: 0,
    fuzzy: 0,
    skipped: 0,
    done: 0,
    batchDurations: [],
    batchesDone: 0,
    warnings: [],
  }

  // Only set while a batch is open, so one duration is recorded per batch and an
  // event with no timestamp records none rather than NaN.
  let openedAt: number | undefined
  let batchSize = 0

  const close = (at: unknown) => {
    state.batchesDone += 1
    if (typeof openedAt === 'number' && typeof at === 'number') state.batchDurations.push(at - openedAt)
    openedAt = undefined
    state.phase = undefined
  }

  for (const e of events) {
    switch (e.type) {
      case 'start':
        state.started = true
        state.file = e.file
        state.total = e.total
        state.pending = e.pending
        break
      case 'tm-hit':
        state.fromTm += e.count
        break
      case 'batch-start':
        state.batch = { index: e.index, of: e.of }
        state.phase = undefined
        openedAt = typeof e.at === 'number' ? e.at : undefined
        batchSize = e.size
        break
      case 'batch-phase':
        state.phase = { name: e.phase, since: e.at }
        break
      case 'batch-done':
        state.translated += e.translated
        state.fuzzy += e.fuzzy
        close(e.at)
        break
      // A skipped batch still cost whatever it spent failing, so it is timed like
      // any other.
      case 'batch-skipped':
        state.skipped += e.size
        state.warnings.push(`Batch ${e.index} skipped (${e.size} entries): ${e.reason}`)
        close(e.at)
        break
      case 'warning':
        state.warnings.push(e.message)
        break
      case 'saved':
        break
      case 'done':
        state.summary = e.summary
        break
    }
  }
  state.remainingMs = estimateRemainingMs(
    state.batchDurations,
    (state.batch?.of ?? 0) - state.batchesDone,
    batchSize,
  )

  if (state.summary) {
    state.phase = undefined
    state.remainingMs = undefined
    state.fromTm = state.summary.fromTm
    state.translated = state.summary.translated
    state.fuzzy = state.summary.fuzzy
    state.skipped = state.summary.skipped
  }
  state.done = state.fromTm + state.translated + state.skipped
  return state
}

// The TUI has a whole line to itself, so it draws the same bar wider than the
// CLI does.
const BAR_WIDTH = 20

export function renderBar(done: number, total: number): string {
  return bar(done, total, BAR_WIDTH)
}

export function formatSummary(summary: TranslateSummary): string {
  return `Done. ${summary.translated} translated, ${summary.fuzzy} fuzzy, ${summary.fromTm} from TM, ${summary.skipped} skipped.`
}

export function Progress({ events }: { events: TranslateEvent[] }) {
  const state = reduceProgress(events)
  const elapsed = useElapsed(state.phase !== undefined, state.phase?.since ?? 0)
  const [opened, setOpened] = useState(false)
  // Translate writes in place, so the file to open is the one that was handed in.
  const translatedFile = state.summary?.file

  // Only once the run is over: during it the keys belong to pause, resume and
  // stop, and opening the file mid-run would show a catalogue still being
  // rewritten after every batch.
  useInput((input) => {
    if (input === 'o' && translatedFile !== undefined) setOpened(openInDefaultApp(translatedFile))
  })

  if (!state.started) return <Text dimColor>Starting…</Text>

  const batch = state.batch ? `  batch ${state.batch.index}/${state.batch.of}` : ''
  return (
    <Box flexDirection="column">
      <Text>
        {renderBar(state.done, state.pending)} {state.done}/{state.pending}
        {batch}  fuzzy {state.fuzzy}
        {state.phase ? ` · ${state.phase.name} ${elapsed}s` : ''}
        {state.remainingMs === undefined
          ? ''
          : ` · ~${formatDuration(state.remainingMs)} left, done by ${formatFinishTime(state.remainingMs)}`}
      </Text>
      <Text dimColor>
        {state.file} · {state.total} entries, {state.pending} selected, {state.fromTm} from TM
      </Text>
      {state.warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Warnings:</Text>
          {state.warnings.map((w, i) => (
            <Text key={i} color="yellow">
              {'  - '}
              {w}
            </Text>
          ))}
        </Box>
      )}
      {state.summary && (
        <Box flexDirection="column" marginTop={1}>
          {state.summary.stopped && <Text color="red">Stopped: {state.summary.stopped}</Text>}
          <Text bold>{formatSummary(state.summary)}</Text>
          <Text>Open {state.summary.file} in PoEdit to review.</Text>
          <Text dimColor>o to open it</Text>
          {opened && <Text color="green">Opening it now.</Text>}
        </Box>
      )}
    </Box>
  )
}
