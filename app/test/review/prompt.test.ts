import { describe, expect, it } from 'vitest'
import { buildReviewPrompt, localeLabel } from '../../src/review/prompt.js'
import type { ReviewInput } from '../../src/types.js'

const inputs: ReviewInput[] = [
  { key: 'Save changes', msgid: 'Save changes', comments: ['button label'], drafts: ['Değişiklikleri kaydet'] },
  {
    key: 'post status\x04Published',
    msgid: 'Published',
    msgctxt: 'post status',
    comments: [],
    drafts: ['Yayımlandı'],
  },
  {
    key: '%d item',
    msgid: '%d item',
    msgidPlural: '%d items',
    comments: [],
    drafts: ['%d öğe', '%d öğe'],
  },
]

describe('buildReviewPrompt', () => {
  const prompt = buildReviewPrompt(inputs, 'tr', 2)

  it('contains every msgid, msgctxt, msgidPlural and draft as JSON entries', () => {
    for (const input of inputs) {
      expect(prompt).toContain(JSON.stringify(input.msgid))
      for (const draft of input.drafts) expect(prompt).toContain(JSON.stringify(draft))
    }
    expect(prompt).toContain('"msgctxt":"post status"')
    expect(prompt).toContain('"msgidPlural":"%d items"')
  })

  it('identifies entries by 1-based id and never asks the model to echo the gettext key', () => {
    expect(prompt).toMatch(/^1\. \{"id":1,/m)
    expect(prompt).toMatch(/^2\. \{"id":2,/m)
    expect(prompt).toMatch(/^3\. \{"id":3,/m)
    expect(prompt).not.toContain('\x04')
    expect(prompt).not.toContain('\\u0004')
    expect(prompt).not.toContain('"key"')
    expect(prompt).toMatch(/exactly one result per input id/i)
  })

  it('names all three MCP tools', () => {
    expect(prompt).toContain('glossary_lookup')
    expect(prompt).toContain('consistency_lookup')
    expect(prompt).toContain('tm_lookup')
  })

  it('states the role, locale and nplurals', () => {
    expect(prompt).toMatch(/senior WordPress Turkish \(tr\) translator/)
    expect(prompt).toContain('Target locale: tr')
    expect(prompt).toContain('nplurals: 2')
  })

  it('states the fuzzy rule', () => {
    expect(prompt).toMatch(/fuzzy=true ONLY when/)
    expect(prompt).toMatch(/otherwise fuzzy=false/i)
    expect(prompt).toMatch(/do not over-flag/i)
  })

  it('states placeholder and formatting preservation rules', () => {
    expect(prompt).toContain('%1$s')
    expect(prompt).toMatch(/HTML tags/)
    expect(prompt).toMatch(/whitespace/i)
  })

  it('uses the given locale rather than a hardcoded one', () => {
    const de = buildReviewPrompt(inputs, 'de', 3)
    expect(de).toContain('nplurals: 3')
    expect(de).toContain('WordPress German (de) glossary')
    expect(de).not.toMatch(/Turkish/)
  })
})

describe('localeLabel', () => {
  it('renders a language name with the code', () => {
    expect(localeLabel('tr')).toBe('Turkish (tr)')
    expect(localeLabel('pt-BR')).toBe('Brazilian Portuguese (pt-BR)')
  })

  it('falls back to the bare code for unknown locales', () => {
    expect(localeLabel('zz-Wxyz')).toBe('locale zz-Wxyz')
    expect(localeLabel('not a locale!')).toBe('locale not a locale!')
  })
})
