import { Box, Text } from 'ink'
import { TOKENS, type Token } from '../../ui/tokens.js'
import { frameLayout, frameSize, useSize, type Size } from '../size.js'

/**
 * The most entries a run screen holds on to.
 *
 * The screens keep every event they are handed, because the reducers fold the
 * whole list on each render. The per-entry events would make that list grow
 * with the file: a seven-thousand-entry review would keep seven thousand
 * entries alive to show the last eight. appendEvent keeps this many and drops
 * the rest, which is still more than the tallest panel shows.
 */
export const RECENT_LIMIT = 50

interface EntriesEvent<T> {
  type: 'entries'
  entries: T[]
}

function isEntries<T>(e: { type: string }): e is EntriesEvent<T> {
  return e.type === 'entries'
}

/**
 * Appends an event, then drops entries older than the last `limit`.
 *
 * Only `entries` events are touched. Everything else the reducers count (the
 * batch boundaries, the timings the estimate is built from, the summary) is
 * kept exactly as it was, so the bar and the counts cannot change because of
 * this. An event that ends up with no entries is removed rather than kept
 * empty, so the list stays short too.
 */
export function appendEvent<E extends { type: string }>(prev: readonly E[], next: E, limit = RECENT_LIMIT): E[] {
  const events = [...prev, next]
  if (!isEntries(next)) return events
  let budget = limit
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (!isEntries<unknown>(e)) continue
    if (budget <= 0) {
      events.splice(i, 1)
      continue
    }
    if (e.entries.length > budget) events[i] = { ...e, entries: e.entries.slice(-budget) }
    budget -= Math.min(budget, e.entries.length)
  }
  return events
}

/** The newest `n` entries across every entries event, oldest first. */
export function recentEntries<T>(events: readonly { type: string }[], n: number): T[] {
  const out: T[] = []
  for (let i = events.length - 1; i >= 0 && out.length < n; i--) {
    const e = events[i]!
    if (!isEntries<T>(e)) continue
    for (let j = e.entries.length - 1; j >= 0 && out.length < n; j--) out.push(e.entries[j]!)
  }
  return out.reverse()
}

// What the run screens draw around the panel: the title and provider lines, the
// bar, the file line, the panel's own heading and the gap above it, and the
// key hint below. Under 80 columns the bar and the file line each wrap onto a
// second line, which is the one extra. Measured on the review screen, which
// has the longer lines of the two.
const CHROME_ROWS = 9
const NARROW_EXTRA = 1
const MIN_ROWS = 3
// Past this a taller terminal shows more of the history rather than the
// last dozen entries spread over half the screen.
const MAX_ROWS = 12

/**
 * How many entries the panel lists at this terminal size.
 *
 * Worked out from the frame the App lays out (the header is two rows taller
 * where the wordmark shows), so the panel and the pause and stop keys below it
 * fit on one page without the body having to scroll to keep the keys in view.
 * Never below three: a smaller panel is a flicker, not a list.
 */
export function panelRows(window: Size): number {
  const size = frameSize(window)
  const header = frameLayout(size).wordmark ? 4 : 2
  // The header, the footer's two rows and the margin above the body.
  const body = size.rows - header - 2 - 1
  const chrome = CHROME_ROWS + (size.columns < 80 ? NARROW_EXTRA : 0)
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, body - chrome))
}

export interface PanelRow {
  key: string
  // A word, not an icon: the outcome is the thing being read, and a glyph would
  // need a legend the panel has no room for.
  outcome: string
  tone: Token
  // Rule ids, or where a draft came from. Muted, and cut before the msgid is.
  detail?: string
  msgid: string
}

// Wide enough for the longest outcome word, `unreviewed`, and a space.
const OUTCOME_WIDTH = 11

/**
 * The last few entries a run decided, newest at the bottom, like a log.
 *
 * Renders nothing until something has landed, so the screen before the first
 * batch is exactly what it was. Each row is one line cut at the frame's edge:
 * a wrapped row would push the rows below it, and the key hint, down.
 */
export function RecentEntries({ rows }: { rows: PanelRow[] }) {
  const size = useSize()
  const shown = rows.slice(-panelRows(size))
  if (shown.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text {...TOKENS.muted.ink}>Recent entries</Text>
      {shown.map((row, i) => (
        <Text key={`${i}:${row.key}`} wrap="truncate-end">
          <Text {...TOKENS[row.tone].ink}>{row.outcome.padEnd(OUTCOME_WIDTH)}</Text>
          {row.msgid}
          {row.detail ? <Text {...TOKENS.muted.ink}>{`  ${row.detail}`}</Text> : null}
        </Text>
      ))}
    </Box>
  )
}
