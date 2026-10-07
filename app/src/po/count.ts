import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

// Extensions whose contents are gettext catalogues. A .tmx or a stray text file
// has no entries to count, and labelling one with a number would invent a fact
// about it.
const COUNTABLE: ReadonlySet<string> = new Set(['.po', '.pot'])

// Every line that opens an entry. The trailing space is load-bearing twice over:
// `msgid_plural` continues an entry rather than opening one, and `#~ msgid`
// marks an entry GlotPress has retired. Neither matches, which is the same pair
// of choices PoFile makes when it walks the parsed catalogue.
const ENTRY = /^msgid /gm

// The header is the entry whose msgid is empty, and PoFile skips it. Counting it
// would report one more string than any run over the file will ever look at.
// Only the header can match: any other entry has something between the quotes.
const HEADER = /^msgid ""/m

interface Counted {
  mtimeMs: number
  size: number
  entries: number
}

// Invalidated by mtime and size together rather than by either alone: a rewrite
// that lands in the same millisecond usually changes the length, and one that
// keeps the length usually moves the clock.
//
// Worth caching because the file picker re-reads its whole directory on every
// sort change, and re-scanning megabytes on each keystroke is the difference
// between an instant list and a visible stall.
const cache = new Map<string, Counted>()

/**
 * How many translatable entries a catalogue holds, header excluded.
 *
 * Counts opening lines rather than parsing, which is roughly twenty-five times
 * faster on a megabyte-scale file and agrees with the parser on every export
 * translate.wordpress.org produces. The two can only disagree if a file repeats
 * a msgid inside one context, which the parser collapses and this does not;
 * GlotPress never emits that, and a picker hint is not the place to pay 50ms a
 * file to defend against it.
 *
 * Returns undefined rather than throwing, and rather than guessing zero: a file
 * that cannot be read has an unknown entry count, and showing `0` for one would
 * read as "this catalogue is empty".
 */
export function countEntries(path: string): number | undefined {
  if (!COUNTABLE.has(extname(path).toLowerCase())) return undefined

  let stat
  try {
    stat = statSync(path)
  } catch {
    return undefined
  }

  const hit = cache.get(path)
  if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entries

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }

  const opened = text.match(ENTRY)?.length ?? 0
  const entries = HEADER.test(text) ? Math.max(0, opened - 1) : opened
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, entries })
  return entries
}

/**
 * The entry count as a picker annotation, or undefined when there is none.
 *
 * Exported as a module-level function so callers hand the picker a stable
 * reference. An inline arrow would change identity on every render and defeat
 * the memo that keeps the directory from being re-read on every keystroke.
 */
export function poEntryCount(path: string): string | undefined {
  const entries = countEntries(path)
  return entries === undefined ? undefined : String(entries)
}
