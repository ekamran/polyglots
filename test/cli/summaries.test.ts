import { describe, expect, it } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { translateSummary } from '../../src/cli/summaries.js'
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
