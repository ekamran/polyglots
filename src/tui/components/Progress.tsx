import { Box, Text } from 'ink'
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
    warnings: [],
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
        break
      case 'batch-done':
        state.translated += e.translated
        state.fuzzy += e.fuzzy
        break
      case 'batch-skipped':
        state.skipped += e.size
        state.warnings.push(`Batch ${e.index} skipped (${e.size} entries): ${e.reason}`)
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
  if (state.summary) {
    state.fromTm = state.summary.fromTm
    state.translated = state.summary.translated
    state.fuzzy = state.summary.fuzzy
    state.skipped = state.summary.skipped
  }
  state.done = state.fromTm + state.translated + state.skipped
  return state
}

export function renderBar(done: number, total: number, width = 20): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1
  const filled = Math.round(ratio * width)
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

export function formatSummary(summary: TranslateSummary): string {
  return `Done. ${summary.translated} translated, ${summary.fuzzy} fuzzy, ${summary.fromTm} from TM, ${summary.skipped} skipped.`
}

export function Progress({ events }: { events: TranslateEvent[] }) {
  const state = reduceProgress(events)
  if (!state.started) return <Text dimColor>Starting…</Text>

  const batch = state.batch ? `  batch ${state.batch.index}/${state.batch.of}` : ''
  return (
    <Box flexDirection="column">
      <Text>
        {renderBar(state.done, state.pending)} {state.done}/{state.pending}
        {batch}  fuzzy {state.fuzzy}
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
        </Box>
      )}
    </Box>
  )
}
