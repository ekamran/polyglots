import type { TranslateEvent } from '../commands/translate.js'
import type { ReviewEvent } from '../types.js'

export type BatchPhase = 'drafting' | 'reviewing'

export interface ProgressState {
  file: string
  total: number
  pending: number
  done: number
  fuzzy: number
  skipped: number
  batch?: { index: number; of: number }
  phase?: { name: BatchPhase; since: number }
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
      return { ...state, batch: { index: event.index, of: event.of }, phase: undefined }
    case 'batch-phase':
      return { ...state, phase: { name: event.phase, since: event.at } }
    case 'batch-done':
      return {
        ...state,
        done: state.done + event.translated,
        fuzzy: state.fuzzy + event.fuzzy,
        phase: undefined,
      }
    case 'batch-skipped':
      return { ...state, done: state.done + event.size, skipped: state.skipped + event.size }
    default:
      return state
  }
}

export function formatProgress(state: ProgressState, now: number = Date.now()): string {
  const ratio = state.pending === 0 ? 1 : Math.min(1, state.done / state.pending)
  const filled = ratio === 1 ? BAR_WIDTH : Math.min(BAR_WIDTH - 1, Math.round(ratio * BAR_WIDTH))
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`
  const parts = [`${bar} ${state.done}/${state.pending}`]
  if (state.batch) {
    parts.push(`batch ${state.batch.index}/${state.batch.of}`, `fuzzy ${state.fuzzy}`)
  }
  if (state.phase) {
    parts.push(`${state.phase.name} ${Math.max(0, Math.round((now - state.phase.since) / 1000))}s`)
  }
  return parts.join('  ')
}

export function noticeFor(event: TranslateEvent, state: ProgressState = initialProgress): string | undefined {
  switch (event.type) {
    case 'start':
      return `Translating ${event.file}: ${event.pending} of ${event.total} entries selected`
    case 'warning':
      return `warning: ${event.message}`
    case 'batch-phase':
      return `batch ${event.index}/${state.batch?.of ?? '?'} ${event.phase}…`
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
    case 'batch-phase':
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

// A batch is two long calls, so the bar sits still for tens of seconds. On a
// terminal the line is redrawn on a timer while a phase runs, which keeps the
// elapsed clock moving and shows the run has not wedged. The timer is unref'd so
// it can never hold the process open.
const TICK_MS = 1000

export function createProgressReporter(stream: ProgressStream): ProgressReporter {
  let state = initialProgress
  let liveLine = false
  let ticker: NodeJS.Timeout | undefined
  const tty = stream.isTTY === true

  const stopTicking = () => {
    if (!ticker) return
    clearInterval(ticker)
    ticker = undefined
  }

  const startTicking = () => {
    if (!tty || ticker) return
    ticker = setInterval(() => {
      if (!state.phase) return
      stream.write(`${CLEAR_LINE}${formatProgress(state)}`)
      liveLine = true
    }, TICK_MS)
    ticker.unref?.()
  }

  const clearLive = () => {
    stopTicking()
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
    if (state.phase) startTicking()
    else stopTicking()
  }

  return Object.assign(report, { finish: clearLive })
}

// How many recent batches the estimate looks at. Long enough to smooth a single
// slow call, short enough to follow a real change in throughput.
const ETA_WINDOW = 5

// Median rather than mean: one batch that stalls near the timeout would otherwise
// dominate the estimate for the rest of the run.
export function estimateRemainingMs(durations: number[], remaining: number): number | undefined {
  if (durations.length < 2 || remaining <= 0) return undefined
  const recent = [...durations.slice(-ETA_WINDOW)].sort((a, b) => a - b)
  const median = recent[Math.floor(recent.length / 2)]
  return median === undefined ? undefined : median * remaining
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatFinishTime(ms: number, now: number = Date.now()): string {
  return new Date(now + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export interface ReviewProgressReporter {
  (event: ReviewEvent): void
  finish(): void
}

export function createReviewProgressReporter(stream: ProgressStream): ReviewProgressReporter {
  let of = 0
  let index = 0
  let flagged = 0
  let liveLine = false
  let inFlightSince: number | undefined
  let ticker: NodeJS.Timeout | undefined
  const durations: number[] = []
  const tty = stream.isTTY === true

  const stopTicking = () => {
    if (!ticker) return
    clearInterval(ticker)
    ticker = undefined
  }

  const clearLive = () => {
    stopTicking()
    if (!liveLine) return
    stream.write(CLEAR_LINE)
    liveLine = false
  }

  // A review batch is one claude call of minutes, so the bar cannot move while it
  // runs. The clock is the only thing separating work from a wedged subprocess.
  const startTicking = () => {
    if (!tty || ticker) return
    ticker = setInterval(() => {
      if (inFlightSince === undefined) return
      stream.write(`${CLEAR_LINE}${line()}`)
      liveLine = true
    }, 1000)
    ticker.unref?.()
  }

  // Timing comes off the events rather than the wall clock so the estimate is
  // whatever the reviewer actually spent, and is reproducible in a test.
  const close = (at: number): void => {
    if (inFlightSince !== undefined && typeof at === 'number') durations.push(at - inFlightSince)
    inFlightSince = undefined
  }

  const line = (now: number = Date.now()): string => {
    const done = inFlightSince === undefined ? index : index - 1
    // of === 0 means no batch has started yet, which is an empty bar, not a full one.
    const ratio = of === 0 ? 0 : Math.min(1, done / of)
    const filled = ratio === 1 ? BAR_WIDTH : Math.min(BAR_WIDTH - 1, Math.round(ratio * BAR_WIDTH))
    const bar = `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`
    const base = `${bar} batch ${index}/${of}  flagged ${flagged}`
    const parts = [base]
    if (inFlightSince !== undefined) {
      parts.push(`reviewing ${Math.max(0, Math.round((now - inFlightSince) / 1000))}s`)
    }
    const remaining = estimateRemainingMs(durations, of - done)
    if (remaining !== undefined) {
      parts.push(`~${formatDuration(remaining)} left, done by ${formatFinishTime(remaining, now)}`)
    }
    return parts.join('  ')
  }

  const report = (event: ReviewEvent): void => {
    let notice: string | undefined
    switch (event.type) {
      case 'start':
        notice = `Reviewing ${event.file}: ${event.reviewable} of ${event.total} entries submitted`
        break
      case 'batch-start':
        of = event.of
        index = event.index
        inFlightSince = event.at
        break
      case 'batch-done':
        flagged += event.problems
        close(event.at)
        break
      case 'batch-failed':
        close(event.at)
        notice = `batch ${event.index} failed (${event.size} entries, flagged as unreviewed): ${event.reason}`
        break
      case 'written':
        notice = `wrote ${event.file}`
        break
      default:
        break
    }

    if (!tty) {
      if (notice) stream.write(`${notice}\n`)
      if (event.type === 'batch-done') stream.write(`${line()}\n`)
      return
    }
    if (event.type === 'done') {
      clearLive()
      return
    }
    if (notice) stream.write(`${CLEAR_LINE}${notice}\n`)
    if (notice || event.type === 'batch-start' || event.type === 'batch-done') {
      stream.write(`${CLEAR_LINE}${line()}`)
      liveLine = true
    }
    if (inFlightSince !== undefined) startTicking()
    else stopTicking()
  }

  return Object.assign(report, { finish: clearLive })
}
