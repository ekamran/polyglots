import { describe, expect, it, vi } from 'vitest'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'
import { auditEntries } from '../../src/audit/audit.js'
import { buildAuditPrompt } from '../../src/audit/prompt.js'
import { mapAuditResults } from '../../src/audit/schema.js'

const GLOSSARY: GlossaryEntry[] = [
  { locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu', partOfSpeech: 'noun' },
]

function entry(key: string, msgid: string, msgstr: string): AuditEntry {
  return { key, msgid, msgstr: [msgstr], comments: [], references: [], fuzzy: false }
}

const clean = entry('a', 'Save all changes', 'Tüm değişiklikleri kaydet')
const hardError = entry('b', '%s comments', 'yorumlar')
const suspect = entry('c', 'Sidebar', 'Yan menü')

function base(overrides = {}) {
  return { locale: 'tr', nplurals: 2, glossary: GLOSSARY, mcpConfigPath: '/tmp/mcp.json', ...overrides }
}

describe('auditEntries', () => {
  it('flags hard errors without consulting the AI', async () => {
    const adjudicate = vi.fn().mockResolvedValue([])
    const verdicts = await auditEntries({ entries: [hardError], ...base(), adjudicate })

    expect(adjudicate).not.toHaveBeenCalled()
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ key: 'b', problem: true })
    expect(verdicts[0]!.findings.map((f) => f.rule)).toEqual(['placeholder'])
  })

  it('sends suspects to the AI carrying their rule findings as hints', async () => {
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'inflected form' }])
    await auditEntries({ entries: [suspect], ...base(), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(1)
    const [batch] = adjudicate.mock.calls[0]!
    expect(batch).toHaveLength(1)
    expect(batch[0]).toMatchObject({ id: 1, key: 'c', msgid: 'Sidebar', msgstr: ['Yan menü'] })
    expect(batch[0].hints.map((h: { rule: string }) => h.rule)).toContain('glossary')
  })

  it('forwards the entry references to the adjudicator', async () => {
    const withRefs = { ...suspect, references: ['includes/admin-menu.php:42'] }
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'ok' }])
    await auditEntries({ entries: [withRefs], ...base(), adjudicate })
    expect(adjudicate.mock.calls[0]![0][0]).toMatchObject({ references: ['includes/admin-menu.php:42'] })
  })

  it('lets the AI clear a suspect the rules raised', async () => {
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'correct form' }])
    const [verdict] = await auditEntries({ entries: [suspect], ...base(), adjudicate })

    expect(verdict).toMatchObject({ key: 'c', problem: false })
  })

  it('lets the AI confirm a suspect, keeping both the rule finding and its own', async () => {
    const adjudicate = vi
      .fn()
      .mockResolvedValue([{ id: 1, problem: true, categories: ['glossary'], reason: 'ignores the approved term' }])
    const [verdict] = await auditEntries({ entries: [suspect], ...base(), adjudicate })

    expect(verdict!.problem).toBe(true)
    expect(verdict!.findings.map((f) => f.rule)).toEqual(['glossary', 'ai:glossary'])
    expect(verdict!.reason).toContain('ignores the approved term')
  })

  it('sends clean entries to the AI too, so meaning errors are caught', async () => {
    const adjudicate = vi
      .fn()
      .mockResolvedValue([{ id: 1, problem: true, categories: ['meaning'], reason: 'says the opposite' }])
    const [verdict] = await auditEntries({ entries: [clean], ...base(), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(1)
    expect(verdict).toMatchObject({ key: 'a', problem: true })
    expect(verdict!.findings.map((f) => f.rule)).toEqual(['ai:meaning'])
  })

  it('skips the AI entirely when noAi is set, keeping rule findings as problems', async () => {
    const adjudicate = vi.fn()
    const verdicts = await auditEntries({ entries: [clean, suspect], ...base({ noAi: true }), adjudicate })

    expect(adjudicate).not.toHaveBeenCalled()
    expect(verdicts.find((v) => v.key === 'a')!.problem).toBe(false)
    expect(verdicts.find((v) => v.key === 'c')!.problem).toBe(true)
  })

  it('batches candidates by batchSize', async () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`k${i}`, `Source ${i}`, `Çeviri ${i}`))
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({ entries: many, ...base({ batchSize: 2 }), adjudicate })

    expect(adjudicate.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([2, 2, 1])
  })

  it('retries a failed batch once, then marks those entries unreviewed problems', async () => {
    const adjudicate = vi.fn().mockRejectedValue(new Error('claude exited with exit code 1'))
    const [verdict] = await auditEntries({ entries: [clean], ...base(), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(2)
    expect(verdict).toMatchObject({ key: 'a', problem: true, unreviewed: true })
    expect(verdict!.reason).toContain('could not be reviewed')
  })

  it('reports batch progress', async () => {
    const events: unknown[] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({ entries: [clean, suspect], ...base({ batchSize: 1 }), adjudicate, onBatch: (e) => events.push(e) })

    expect(events).toEqual([
      { index: 1, of: 2, size: 1, problems: 0 },
      { index: 2, of: 2, size: 1, problems: 0 },
    ])
  })

  it('preserves input order in the returned verdicts', async () => {
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    const verdicts = await auditEntries({ entries: [clean, hardError, suspect], ...base(), adjudicate })
    expect(verdicts.map((v) => v.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildAuditPrompt', () => {
  const candidates = [
    { id: 1, key: 'c', msgid: 'Sidebar', msgstr: ['Yan menü'], comments: [], references: [], hints: [{ rule: 'glossary', severity: 'suspect' as const, message: 'glossary term not used' }] },
    { id: 2, key: 'a', msgid: 'Save all changes', msgstr: ['Tüm değişiklikleri kaydet'], comments: [], references: ['includes/admin-menu.php:42'], hints: [] },
  ]

  it('passes the source references through as the clue to a string\'s role', () => {
    expect(buildAuditPrompt(candidates, 'tr', 2)).toContain('admin-menu.php')
  })

  it('numbers every entry and includes the submitted translation', () => {
    const prompt = buildAuditPrompt(candidates, 'tr', 2)
    expect(prompt).toContain('"id":1')
    expect(prompt).toContain('"id":2')
    expect(prompt).toContain('Yan menü')
  })

  it('passes rule hints through so the model can adjudicate them', () => {
    expect(buildAuditPrompt(candidates, 'tr', 2)).toContain('glossary term not used')
  })

  it('tells the model which proper-noun categories are legitimately capitalized', () => {
    const prompt = buildAuditPrompt(candidates, 'tr', 2)
    expect(prompt).toMatch(/institution/i)
    expect(prompt).toMatch(/place|person/i)
    // A work title (Suç ve Ceza) is correctly title-cased and no rule can tell it
    // from a calque, so the model is the only thing standing between it and a flag.
    expect(prompt).toMatch(/titles of works/i)
  })

  // The locale team tolerates capitalization in menu and screen names and in
  // help-page headings; without this the model flags every one of them.
  // Measured on 11,232 approved core translations: the mirrored arm fires on
  // 0.69% of them, the standalone arm on 2.69%, so they are not equal evidence.
  it('tells the model how much to trust each title-case arm', () => {
    const prompt = buildAuditPrompt(candidates, 'tr', 2)
    expect(prompt).toMatch(/mirrors the English source/i)
    expect(prompt).toMatch(/weaker|weak evidence|less reliable/i)
  })

  it('tells the model not to raise title-case for menu labels and section headings', () => {
    const prompt = buildAuditPrompt(candidates, 'tr', 2)
    expect(prompt).toMatch(/menu label|screen name|section name/i)
    expect(prompt).toMatch(/heading/i)
    expect(prompt).toMatch(/command|button/i)
  })

  it('states the locale team standards and names the lookup tools', () => {
    const prompt = buildAuditPrompt(candidates, 'tr', 2)
    expect(prompt).toMatch(/title case/i)
    expect(prompt).toContain('glossary_lookup')
    expect(prompt).toContain('consistency_lookup')
  })
})

describe('mapAuditResults', () => {
  const candidates = [{ id: 1, key: 'a', msgid: 'x', msgstr: ['y'], comments: [], hints: [] }]

  it('validates and returns the results', () => {
    const out = mapAuditResults(candidates, {
      results: [{ id: 1, problem: true, categories: ['meaning'], reason: 'wrong' }],
    })
    expect(out).toEqual([{ id: 1, problem: true, categories: ['meaning'], reason: 'wrong' }])
  })

  it('throws when an id is missing from the response', () => {
    expect(() => mapAuditResults(candidates, { results: [] })).toThrow(/missing/i)
  })

  it('throws when the payload does not match the schema', () => {
    expect(() => mapAuditResults(candidates, { results: [{ id: 1 }] })).toThrow(/schema/i)
  })

  it('throws on an id outside the batch', () => {
    expect(() =>
      mapAuditResults(candidates, { results: [{ id: 9, problem: false, categories: [], reason: 'x' }] }),
    ).toThrow(/unknown id 9/)
  })
})
