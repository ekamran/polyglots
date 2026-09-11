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
  // The bar counts entries, but time is spent in batches, so the estimate is
  // built from those. Set while a batch is open, so one duration is recorded per
  // batch and an event without a timestamp records none rather than NaN.
  batchStartedAt?: number
  batchDurations: number[]
  batchesDone: number
  batchSize: number
}

export const initialProgress: ProgressState = {
  file: '',
  total: 0,
  pending: 0,
  done: 0,
  fuzzy: 0,
  skipped: 0,
  batchDurations: [],
  batchesDone: 0,
  batchSize: 0,
}

const BAR_WIDTH = 10

// Parallelograms rather than hashes in brackets: the filled and empty cells are
// the same shape and width, so the bar reads as one object at a glance instead
// of as punctuation.
const FILLED = '▰'
const EMPTY = '▱'

// The one bar every surface draws. A total of zero means there was nothing to
// do, which is finished, not stalled; and the last cell stays empty until the
// work really is done, because rounding fills it several percent early and a
// full bar on a run with entries left reads as a hang.
export function renderBar(done: number, total: number, width: number): string {
  const ratio = total === 0 ? 1 : Math.min(1, Math.max(0, done / total))
  const filled = ratio === 1 ? width : Math.min(width - 1, Math.round(ratio * width))
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled)
}

function closeBatch(state: ProgressState, at: number): Partial<ProgressState> {
  const timed = typeof state.batchStartedAt === 'number' && typeof at === 'number'
  return {
    batchesDone: state.batchesDone + 1,
    batchStartedAt: undefined,
    batchDurations: timed ? [...state.batchDurations, at - state.batchStartedAt!] : state.batchDurations,
  }
}

export function applyEvent(state: ProgressState, event: TranslateEvent): ProgressState {
  switch (event.type) {
    case 'start':
      return { ...initialProgress, file: event.file, total: event.total, pending: event.pending }
    case 'tm-hit':
      return { ...state, done: state.done + event.count }
    case 'batch-start':
      return {
        ...state,
        batch: { index: event.index, of: event.of },
        phase: undefined,
        batchStartedAt: event.at,
        batchSize: event.size,
      }
    case 'batch-phase':
      return { ...state, phase: { name: event.phase, since: event.at } }
    case 'batch-done':
      return {
        ...state,
        done: state.done + event.translated,
        fuzzy: state.fuzzy + event.fuzzy,
        phase: undefined,
        ...closeBatch(state, event.at),
      }
    // A skipped batch still cost whatever it spent failing, so it is timed like
    // any other; pretending otherwise would make the estimate optimistic exactly
    // when the run is going badly.
    case 'batch-skipped':
      return {
        ...state,
        done: state.done + event.size,
        skipped: state.skipped + event.size,
        ...closeBatch(state, event.at),
      }
    default:
      return state
  }
}

export function formatProgress(state: ProgressState, now: number = Date.now()): string {
  const parts = [`${renderBar(state.done, state.pending, BAR_WIDTH)} ${state.done}/${state.pending}`]
  if (state.batch) {
    parts.push(`batch ${state.batch.index}/${state.batch.of}`, `fuzzy ${state.fuzzy}`)
  }
  if (state.phase) {
    parts.push(`${state.phase.name} ${Math.max(0, Math.round((now - state.phase.since) / 1000))}s`)
  }
  const remaining = estimateRemainingMs(state.batchDurations, (state.batch?.of ?? 0) - state.batchesDone, state.batchSize)
  if (remaining !== undefined) {
    parts.push(`~${formatDuration(remaining)} left, done by ${formatFinishTime(remaining, now)}`)
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

// Below this the estimate is noise: the wait is over before anyone has read it.
const MIN_ESTIMATE_MS = 10_000

// What a batch costs before this run has timed one of its own. A batch is a
// single claude call over its entries, and the observed pace on real
// submissions is around four seconds an entry, so it scales with batch size.
// Only ever a placeholder: the first batch to land replaces it.
const PRIOR_MS_PER_ENTRY = 4_000

// Median rather than mean: one batch that stalls near the timeout would otherwise
// dominate the estimate for the rest of the run.
export function estimateRemainingMs(durations: number[], remaining: number, batchSize = 0): number | undefined {
  if (remaining <= 0) return undefined
  const recent = [...durations.slice(-ETA_WINDOW)].sort((a, b) => a - b)
  const typical = recent.length > 0 ? recent[Math.floor(recent.length / 2)]! : batchSize * PRIOR_MS_PER_ENTRY
  if (typical <= 0) return undefined
  const estimate = typical * remaining
  return estimate < MIN_ESTIMATE_MS ? undefined : estimate
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
  let batchSize = 0
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
    // `of || 1` because of === 0 means no batch has started yet, which is an
    // empty bar; renderBar reads a total of zero as nothing to do, so full.
    const base = `${renderBar(done, of || 1, BAR_WIDTH)} batch ${index}/${of}  flagged ${flagged}`
    const parts = [base]
    if (inFlightSince !== undefined) {
      parts.push(`reviewing ${Math.max(0, Math.round((now - inFlightSince) / 1000))}s`)
    }
    const remaining = estimateRemainingMs(durations, of - done, batchSize)
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
        if (event.resumed) {
          const n = event.resumed
          notice += `\nResuming an interrupted run: ${n} batch${n === 1 ? '' : 'es'} already reviewed`
        }
        break
      case 'batch-start':
        of = event.of
        index = event.index
        batchSize = event.size
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
