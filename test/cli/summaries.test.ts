import { describe, expect, it } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { fetchTally, reviewSummary, translateSummary } from '../../src/cli/summaries.js'
import { reviewSummaryOf } from '../tui/helpers.js'
import type { ReviewSummary } from '../../src/types.js'
import { createPainter, plainPainter } from '../../src/ui/paint.js'
import type { TranslateSummary } from '../../src/commands/translate.js'

const base: TranslateSummary = { file: 'a.po', total: 412, pending: 412, fromTm: 24, translated: 380, fuzzy: 8, skipped: 0 }

describe('translateSummary', () => {
  it('frames the counts under a Done title and ends with where to look', () => {
    const lines = translateSummary(plainPainter, base, false)
    expect(lines[0]).toMatch(/^╭─ ✓ Done ─+╮$/)
    expect(lines).toContainEqual(expect.stringMatching(/│  translated\s+380\s+│/))
    expect(lines).toContainEqual(expect.stringMatching(/│  fuzzy\s+8  check before upload\s+│/))
    expect(lines.at(-1)).toBe('› Open a.po in PoEdit to review.')
  })

  it('titles a stopped run as stopped and says how to resume', () => {
    const lines = translateSummary(plainPainter, { ...base, stopped: 'stopped before batch 3' }, false)
    expect(lines[0]).toContain('! Stopped')
    expect(lines.at(-1)).toBe('› Re-run the same command to resume.')
  })

  it('says a dry run wrote nothing', () => {
    const lines = translateSummary(plainPainter, base, true)
    expect(lines[0]).toContain('Dry run')
    expect(lines.at(-1)).toBe('› Nothing was written.')
  })

  it('drops the fuzzy note when nothing is fuzzy', () => {
    expect(translateSummary(plainPainter, { ...base, fuzzy: 0 }, false).join('\n')).not.toContain('check before upload')
  })

  it('reads the same with colour on, once the codes are stripped', () => {
    const painted = translateSummary(createPainter({ isTTY: true }, {}), base, false)
    expect(painted.join('\n')).toMatch(/\x1b\[/)
    expect(painted.map((l) => stripVTControlCharacters(l))).toEqual(translateSummary(plainPainter, base, false))
  })
})

// The factory names a problems file by default; a run that wrote none has the
// key absent, not undefined, under exactOptionalPropertyTypes.
function reviewed(patch: Partial<ReviewSummary>, problemsFile: string | undefined): ReviewSummary {
  const { problemsFile: _drop, ...rest } = reviewSummaryOf('a.po', patch)
  return problemsFile === undefined ? rest : { ...rest, problemsFile }
}

describe('reviewSummary', () => {
  it('frames reviewed, flagged and approvable, flagged highlighted', () => {
    const s = reviewed({ reviewed: 120, skipped: 3, problems: 9, needsReview: 2, approvable: 109, pending: 0 }, 'out/a-problems.po')
    const lines = reviewSummary(plainPainter, s, undefined)
    expect(lines[0]).toMatch(/✓ Reviewed/)
    expect(lines.join('\n')).toMatch(/flagged\s+11/)
    expect(lines.join('\n')).toMatch(/approvable\s+109/)
    expect(lines.at(-1)).toBe('› Wrote out/a-problems.po')
  })

  it('titles an early stop with a warning and never says approvable for the rest', () => {
    const s = reviewed({ reviewed: 40, pending: 80, problems: 1, needsReview: 0, approvable: 39 }, undefined)
    const lines = reviewSummary(plainPainter, s, undefined)
    expect(lines[0]).toContain('! Stopped early')
    expect(lines.join('\n')).toMatch(/not reached\s+80/)
    expect(lines.join('\n')).not.toContain('looks approvable')
    expect(lines.at(-1)).toBe('› Re-run the same command to carry on.')
  })

  it('says a clean finished run looks approvable', () => {
    const s = reviewed({ reviewed: 50, pending: 0, problems: 0, needsReview: 0, approvable: 50, repaired: 0, written: 0 }, undefined)
    expect(reviewSummary(plainPainter, s, undefined).at(-1)).toBe('› Nothing flagged; the whole submission looks approvable.')
  })

  it('prints the requester message verbatim under its heading, outside the box', () => {
    const s = reviewed({ reviewed: 10, pending: 0, problems: 1, needsReview: 0, approvable: 9 }, 'p.po')
    const lines = reviewSummary(plainPainter, s, 'Thanks! 1 entry needs a look.')
    const at = lines.indexOf('Message for the requester:')
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(0, at).some((l) => l.startsWith('╰'))).toBe(true)
    expect(lines[at + 1]).toBe('Thanks! 1 entry needs a look.')
  })

  it('reads the same with colour on, once the codes are stripped', () => {
    const s = reviewed({ problems: 2 }, 'p.po')
    const painted = reviewSummary(createPainter({ isTTY: true }, {}), s, 'msg')
    expect(painted.map((l) => stripVTControlCharacters(l))).toEqual(reviewSummary(plainPainter, s, 'msg'))
  })
})

describe('fetchTally', () => {
  it('frames the counts and titles by the worst outcome', () => {
    expect(fetchTally(plainPainter, { done: 3, failed: 0, skipped: 1, stopped: 0 })[0]).toContain('✓ Fetched')
    expect(fetchTally(plainPainter, { done: 2, failed: 1, skipped: 0, stopped: 0 })[0]).toContain('✗ Fetched with failures')
    const stopped = fetchTally(plainPainter, { done: 1, failed: 0, skipped: 0, stopped: 2 })
    expect(stopped[0]).toContain('! Stopped')
    expect(stopped.join('\n')).toMatch(/stopped\s+2/)
    expect(stopped.at(-1)).toBe('› Run the same list again to carry on.')
  })
})
