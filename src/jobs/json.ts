// The leaf the other job-store modules share. `parse` used to be duplicated
// verbatim in verdicts.ts and drafts.ts, and `Clock` was imported from
// verdicts.ts by modules that have nothing to do with verdicts, which is a
// module saying it wants a shared leaf.

// Every clock in the job store is injectable, so a test can freeze `at` rather
// than assert around Date.now().
export type Clock = () => number

// A hand-edited or truncated row reads as a miss rather than as a crash: the
// cache is disposable, and re-asking the model is always a correct answer.
// Anything that is not an array of strings is unreadable, not half-readable:
// substituting a shortened list would hand back a row that looks intact but has
// lost part of what it was built from.
export function parseStringArray(json: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined
  } catch {
    return undefined
  }
}

// A frozen per-run tally, read back for statistics. Same rule as above: a value
// that is not a finite number makes the whole tally unreadable rather than
// partly readable, because a chart built from a tally with one entry silently
// dropped is worse than a chart that admits it has nothing to draw.
export function parseTally(json: string | null): Record<string, number> | undefined {
  if (json === null) return undefined
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const entries = Object.entries(value)
    return entries.every(([, n]) => typeof n === 'number' && Number.isFinite(n))
      ? (Object.fromEntries(entries) as Record<string, number>)
      : undefined
  } catch {
    return undefined
  }
}
