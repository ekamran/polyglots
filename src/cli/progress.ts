import type { TranslateEvent } from '../commands/translate.js'

export interface ProgressState {
  file: string
  total: number
  pending: number
  done: number
  fuzzy: number
  skipped: number
  batch?: { index: number; of: number }
}

export const initialProgress: ProgressState = {
  file: '',
  total: 0,
  pending: 0,
  done: 0,
  fuzzy: 0,
  skipped: 0,
}

const BAR_WIDTH = 10

export function applyEvent(state: ProgressState, event: TranslateEvent): ProgressState {
  switch (event.type) {
    case 'start':
      return { ...initialProgress, file: event.file, total: event.total, pending: event.pending }
    case 'tm-hit':
      return { ...state, done: state.done + event.count }
    case 'batch-start':
      return { ...state, batch: { index: event.index, of: event.of } }
    case 'batch-done':
      return { ...state, done: state.done + event.translated, fuzzy: state.fuzzy + event.fuzzy }
    case 'batch-skipped':
      return { ...state, done: state.done + event.size, skipped: state.skipped + event.size }
    default:
      return state
  }
}

export function formatProgress(state: ProgressState): string {
  const ratio = state.pending === 0 ? 1 : Math.min(1, state.done / state.pending)
  const filled = ratio === 1 ? BAR_WIDTH : Math.min(BAR_WIDTH - 1, Math.round(ratio * BAR_WIDTH))
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`
  const parts = [`${bar} ${state.done}/${state.pending}`]
  if (state.batch) {
    parts.push(`batch ${state.batch.index}/${state.batch.of}`, `fuzzy ${state.fuzzy}`)
  }
  return parts.join('  ')
}

export function noticeFor(event: TranslateEvent, state: ProgressState = initialProgress): string | undefined {
  switch (event.type) {
    case 'start':
      return `Translating ${event.file}: ${event.pending} of ${event.total} entries selected`
    case 'warning':
      return `warning: ${event.message}`
    case 'batch-skipped':
      return `batch ${event.index}/${state.batch?.of ?? '?'} skipped (${event.size} entries): ${event.reason}`
    default:
      return undefined
  }
}

function advancesBar(event: TranslateEvent): boolean {
  switch (event.type) {
    case 'tm-hit':
      return event.count > 0
    case 'batch-start':
    case 'batch-done':
    case 'batch-skipped':
      return true
    default:
      return false
  }
}

export interface ProgressStream {
  isTTY?: boolean
  write(chunk: string): boolean
}

const CLEAR_LINE = '\r\x1b[2K'

export interface ProgressReporter {
  (event: TranslateEvent): void
  finish(): void
}

export function createProgressReporter(stream: ProgressStream): ProgressReporter {
  let state = initialProgress
  let liveLine = false
  const tty = stream.isTTY === true

  const clearLive = () => {
    if (!liveLine) return
    stream.write(CLEAR_LINE)
    liveLine = false
  }

  const report = (event: TranslateEvent): void => {
    state = applyEvent(state, event)
    const notice = noticeFor(event, state)
    const line = formatProgress(state)

    if (!tty) {
      if (notice) stream.write(`${notice}\n`)
      if (event.type === 'batch-done' || event.type === 'batch-skipped' || (event.type === 'tm-hit' && event.count > 0)) {
        stream.write(`${line}\n`)
      }
      return
    }

    if (event.type === 'done') {
      clearLive()
      return
    }
    if (notice) stream.write(`${CLEAR_LINE}${notice}\n`)
    if (notice || advancesBar(event)) {
      stream.write(`${CLEAR_LINE}${line}`)
      liveLine = true
    }
  }

  return Object.assign(report, { finish: clearLive })
}
