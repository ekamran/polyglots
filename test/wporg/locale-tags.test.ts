import { describe, expect, it } from 'vitest'
import { buildAuditPrompt } from '../../src/audit/prompt.js'
import { lower } from '../../src/audit/rules/text.js'
import { createDeepLEngine, toDeepLTarget } from '../../src/draft/deepl.js'
import { describeLocale } from '../../src/draft/prompt.js'
import { buildReviewPrompt } from '../../src/review/prompt.js'
import { customFindings } from '../../src/rules/custom.js'

// "nl/formal" is a polyglots id, not a language tag. toLocaleLowerCase and
// Intl throw a RangeError on it, so each has to be given the language.
describe('a locale with a translation set', () => {
  it('lowercases without throwing', () => {
    expect(lower('INDEX', 'nl/formal')).toBe('index')
    expect(lower('I', 'tr')).toBe('ı')
  })

  it('is named by its language and set in the prompts', () => {
    expect(buildAuditPrompt([], 'nl/formal', 2)).toContain('Dutch (formal)')
    expect(buildReviewPrompt([], 'nl/formal', 2)).toContain('Dutch (formal)')
    expect(describeLocale('nl/formal')).toContain('Dutch (formal)')
    expect(buildAuditPrompt([], 'tr', 2)).not.toContain('(default)')
  })

  it('runs custom patterns without throwing', () => {
    const p = { kind: 'mistake' as const, text: 'u', level: 'hint' as const, ignoreCase: true }
    expect(customFindings({ msgid: 'You', msgstr: ['U'] }, [p], 'nl/formal')).toHaveLength(1)
  })

  it('asks DeepL for the language of the slug', () => {
    expect(toDeepLTarget('nl/formal')).toBe('nl')
    expect(toDeepLTarget('pt/ao90')).toBe('pt-PT')
    expect(toDeepLTarget('de-ch/informal')).toBe('de')
  })

  // DeepL's formality option is what a formal or informal set changes for a draft.
  it('asks DeepL for the register of a formal or informal set', async () => {
    const seen: unknown[] = []
    const client = {
      translateText: async (texts: string[], _s: unknown, _t: unknown, options?: unknown) => {
        seen.push(options)
        return texts.map((text) => ({ text }))
      },
    }
    const engine = createDeepLEngine({ apiKey: 'x', client })
    const unit = { key: 'k', msgid: 'Hello', comments: [], references: [] }
    await engine.translate([unit as never], 'nl/formal', 2)
    await engine.translate([unit as never], 'de/informal', 2)
    await engine.translate([unit as never], 'nl', 2)
    expect(seen).toEqual([
      { preserveFormatting: true, formality: 'prefer_more' },
      { preserveFormatting: true, formality: 'prefer_less' },
      { preserveFormatting: true },
    ])
  })
})
