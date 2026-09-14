import { describe, expect, it, vi } from 'vitest'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'
import { auditEntries } from '../../src/audit/audit.js'
import { createRunControl } from '../../src/run-control.js'
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
  // The rules proved it broken, so the model's job is to fix it, not to argue.
  it('sends a rule-condemned entry to the model to be repaired', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: true, categories: ['placeholder'] as never[], reason: 'lost %s', fix: ['%s yorum'] })),
    )
    const verdicts = await auditEntries({ entries: [hardError], ...base(), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(1)
    expect(verdicts[0]).toMatchObject({ key: 'b', problem: true, text: ['%s yorum'], repairedBy: 'model' })
  })

  it('does not let the model clear what the rules proved broken', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'looks fine to me' })),
    )
    const verdicts = await auditEntries({ entries: [hardError], ...base(), adjudicate })

    expect(verdicts[0]).toMatchObject({ key: 'b', problem: true })
    expect(verdicts[0]!.findings.map((f) => f.rule)).toContain('placeholder')
  })

  it('takes the fix even when the model wrongly cleared a rule-condemned entry', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok', fix: ['%s yorum'] })),
    )
    const verdicts = await auditEntries({ entries: [hardError], ...base(), adjudicate })
    expect(verdicts[0]!.text).toEqual(['%s yorum'])
  })

  it('records why a bad fix was thrown away rather than silently dropping it', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: true, categories: ['placeholder'] as never[], reason: 'lost %s', fix: ['hala yorumlar'] })),
    )
    const verdicts = await auditEntries({ entries: [hardError], ...base(), adjudicate })

    expect(verdicts[0]!.text).toBeUndefined()
    expect(verdicts[0]!.findings.map((f) => f.message).join(' ')).toMatch(/rejected/i)
  })

  it('ignores a fix on an entry that had nothing wrong with it', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok', fix: ['Başka bir şey'] })),
    )
    const verdicts = await auditEntries({ entries: [clean], ...base(), adjudicate })
    expect(verdicts[0]!.text).toBeUndefined()
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

  it('never calls the AI when noAi is set', async () => {
    const adjudicate = vi.fn()
    const verdicts = await auditEntries({ entries: [clean, suspect], ...base({ noAi: true }), adjudicate })

    expect(adjudicate).not.toHaveBeenCalled()
    expect(verdicts.find((v) => v.key === 'a')!.problem).toBe(false)
    expect(verdicts).toHaveLength(2)
  })

  // Without the model nothing adjudicates a suspect, so a soft finding must not
  // masquerade as a confirmed problem.
  it('separates hard errors from soft findings under noAi', async () => {
    const adjudicate = vi.fn()
    const verdicts = await auditEntries({ entries: [clean, hardError, suspect], ...base({ noAi: true }), adjudicate })
    const byKey = new Map(verdicts.map((v) => [v.key, v]))

    expect(byKey.get('b')).toMatchObject({ problem: true })
    expect(byKey.get('b')!.needsReview).toBeFalsy()
    expect(byKey.get('c')).toMatchObject({ problem: false, needsReview: true })
    expect(byKey.get('a')).toMatchObject({ problem: false })
    expect(byKey.get('a')!.needsReview).toBeFalsy()
  })

  it('never marks a verdict needsReview when the model is in the loop', async () => {
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'ok' }])
    const [verdict] = await auditEntries({ entries: [suspect], ...base(), adjudicate })
    expect(verdict!.needsReview).toBeFalsy()
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

  // Resuming an interrupted run: the first batches were decided and persisted by
  // the earlier run, so re-paying for them would be the whole cost of resuming.
  it('skips the batches a previous run already finished', async () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`k${i}`, `Source ${i}`, `Çeviri ${i}`))
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({ entries: many, ...base({ batchSize: 2, skipBatches: 2 }), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(1)
    const [batch] = adjudicate.mock.calls[0]!
    expect((batch as { key: string }[]).map((c) => c.key)).toEqual(['k4'])
  })

  it('keeps numbering batches from one when it resumes, so progress reads against the whole run', async () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`k${i}`, `Source ${i}`, `Çeviri ${i}`))
    const starts: { index: number; of: number }[] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({
      entries: many,
      ...base({ batchSize: 2, skipBatches: 2 }),
      adjudicate,
      onBatchStart: (b: { index: number; of: number }) => starts.push({ index: b.index, of: b.of }),
    })

    expect(starts).toEqual([{ index: 3, of: 3 }])
  })

  // Whatever the skipped batches decided lives in the problems file, not here.
  it('returns verdicts only for the entries it actually decided', async () => {
    const many = Array.from({ length: 5 }, (_, i) => entry(`k${i}`, `Source ${i}`, `Çeviri ${i}`))
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    const verdicts = await auditEntries({ entries: many, ...base({ batchSize: 2, skipBatches: 2 }), adjudicate })

    expect(verdicts.map((v) => v.key)).toEqual(['k4'])
  })

  it('retries a failed batch once, then marks those entries unreviewed problems', async () => {
    const adjudicate = vi.fn().mockRejectedValue(new Error('claude exited with exit code 1'))
    const [verdict] = await auditEntries({ entries: [clean], ...base(), adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(2)
    expect(verdict).toMatchObject({ key: 'a', problem: true, unreviewed: true })
    expect(verdict!.reason).toContain('could not be reviewed')
  })

  // The UI showed "0 flagged by rules" forever because nothing reported the rule
  // pass, and 0/0 because a batch only announced itself once it had finished.
  it('reports what the rules decided before any AI call', async () => {
    const seen: unknown[] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({
      entries: [clean, hardError, suspect],
      ...base(),
      adjudicate,
      onRules: (r) => seen.push(r),
    })
    expect(seen).toEqual([{ flagged: 1, suspects: 1 }])
  })

  // A whitespace repair is settled, not an open question, so it must not swell
  // the count of entries the user is told the model still has to weigh.
  it('does not count a mechanical repair among the suspects it reports', async () => {
    const seen: unknown[] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({
      entries: [entry('d', 'Save ', 'Kaydet')],
      ...base(),
      adjudicate,
      onRules: (r) => seen.push(r),
    })
    expect(seen).toEqual([{ flagged: 0, suspects: 0 }])
  })

  it('announces a batch before running it, not after', async () => {
    const order: string[] = []
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      order.push('adjudicate')
      return batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' }))
    })
    await auditEntries({
      entries: [clean, suspect],
      ...base({ batchSize: 1 }),
      adjudicate,
      onBatchStart: () => order.push('start'),
      onBatch: () => {
        order.push('done')
      },
    })
    expect(order).toEqual(['start', 'adjudicate', 'done', 'start', 'adjudicate', 'done'])
  })

  it('hands each batch verdicts over as they are decided', async () => {
    const batches: string[][] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: true, categories: ['meaning'], reason: 'nope' })),
      )
    await auditEntries({
      entries: [clean, suspect],
      ...base({ batchSize: 1 }),
      adjudicate,
      onBatch: (p) => {
        batches.push(p.verdicts.map((v) => v.key))
      },
    })
    expect(batches).toEqual([['a'], ['c']])
  })

  it('waits for a slow onBatch before starting the next batch', async () => {
    const order: string[] = []
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      order.push('adjudicate')
      return batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' }))
    })
    await auditEntries({
      entries: [clean, suspect],
      ...base({ batchSize: 1 }),
      adjudicate,
      onBatch: async () => {
        await new Promise((r) => setTimeout(r, 5))
        order.push('saved')
      },
    })
    expect(order).toEqual(['adjudicate', 'saved', 'adjudicate', 'saved'])
  })

  it('reports why a batch failed so the run can say so', async () => {
    const seen: Array<string | undefined> = []
    const adjudicate = vi.fn().mockRejectedValue(new Error('claude exited with exit code 1'))
    await auditEntries({
      entries: [clean],
      ...base(),
      adjudicate,
      onBatch: (p) => {
        seen.push(p.failed)
      },
    })
    expect(seen[0]).toMatch(/exit code 1/)
  })

  it('reports batch progress', async () => {
    const events: unknown[] = []
    const adjudicate = vi
      .fn()
      .mockImplementation(async (batch: { id: number }[]) =>
        batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' })),
      )
    await auditEntries({
      entries: [clean, suspect],
      ...base({ batchSize: 1 }),
      adjudicate,
      onBatch: (e) => {
        events.push(e)
      },
    })

    expect(events).toEqual([
      { index: 1, of: 2, size: 1, problems: 0, verdicts: [expect.objectContaining({ key: 'a' })] },
      { index: 2, of: 2, size: 1, problems: 0, verdicts: [expect.objectContaining({ key: 'c' })] },
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

  // An entry whose only fault is a dropped trailing space is a hard error today,
  // which means it never reaches the model and can never be fixed at all.
  it('repairs whitespace itself and lets the fixed text clear the rules', async () => {
    const dropped = entry('w', 'Save changes ', 'Değişiklikleri kaydet')
    const adjudicate = vi
      .fn()
      .mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'ok' }])
    const verdicts = await auditEntries({ entries: [dropped], ...base(), adjudicate })

    // It went to the model as an ordinary candidate, not as a condemned entry.
    expect(adjudicate).toHaveBeenCalledTimes(1)
    expect(verdicts[0]).toMatchObject({ key: 'w', text: ['Değişiklikleri kaydet '], repairedBy: 'rules' })
  })

  it('reports the mechanical repair as a finding, so the file says what changed', async () => {
    const dropped = entry('w', 'Save changes ', 'Değişiklikleri kaydet')
    const verdicts = await auditEntries({ entries: [dropped], ...base({ noAi: true }) })
    expect(verdicts[0]!.findings.map((f) => f.rule)).toContain('repaired')
  })

  // Clearing the entry does not un-make the repair. The note is the only record
  // that the text in the file is not what was submitted, and the only thing a
  // resumed run can find the entry by.
  it('keeps the repair note on an entry the model cleared', async () => {
    const dropped = entry('w', 'Save changes ', 'Değişiklikleri kaydet')
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'ok' }])
    const verdicts = await auditEntries({ entries: [dropped], ...base(), adjudicate })

    expect(verdicts[0]).toMatchObject({ problem: false, text: ['Değişiklikleri kaydet '] })
    expect(verdicts[0]!.findings.map((f) => f.rule)).toEqual(['repaired'])
  })

  it('judges the repaired text, not the submitted text', async () => {
    // Whitespace is the entry's only fault, so after repair nothing is wrong.
    const dropped = entry('w', 'Save changes ', 'Değişiklikleri kaydet')
    const verdicts = await auditEntries({ entries: [dropped], ...base({ noAi: true }) })
    expect(verdicts[0]!.findings.map((f) => f.rule)).not.toContain('whitespace')
  })

  it('leaves an entry it cannot mechanically repair without text', async () => {
    const adjudicate = vi.fn().mockResolvedValue([{ id: 1, problem: false, categories: [], reason: 'ok' }])
    const verdicts = await auditEntries({ entries: [clean], ...base(), adjudicate })
    expect(verdicts[0]!.text).toBeUndefined()
    expect(verdicts[0]!.repairedBy).toBeUndefined()
  })
})

// Pausing is for a subscription that ran out of quota mid-run, so it has to stop
// between calls, never inside one: a batch abandoned in flight is quota already
// spent for nothing.
describe('auditEntries under a run control', () => {
  const four = () => Array.from({ length: 4 }, (_, i) => entry(`k${i}`, `Source ${i}`, `Çeviri ${i}`))
  const ok = (batch: { id: number }[]) => batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: 'ok' }))

  it('runs to the end when nothing asks it to stop', async () => {
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => ok(batch))
    await auditEntries({ entries: four(), ...base({ batchSize: 1 }), adjudicate, control: createRunControl() })
    expect(adjudicate).toHaveBeenCalledTimes(4)
  })

  it('finishes the batch it is in before it parks', async () => {
    const control = createRunControl()
    const finished: number[] = []
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      control.pause()
      return ok(batch)
    })

    const run = auditEntries({
      entries: four(),
      ...base({ batchSize: 1 }),
      adjudicate,
      control,
      onBatch: (b: { index: number }) => {
        finished.push(b.index)
      },
    })
    await new Promise((r) => setTimeout(r, 30))

    // The batch that was in flight completed and was reported; the next never started.
    expect(finished).toEqual([1])
    expect(adjudicate).toHaveBeenCalledTimes(1)

    control.stop()
    await run
  })

  it('carries on from where it parked when resumed', async () => {
    const control = createRunControl()
    let seen = 0
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      if (++seen === 1) control.pause()
      return ok(batch)
    })

    const run = auditEntries({ entries: four(), ...base({ batchSize: 1 }), adjudicate, control })
    await new Promise((r) => setTimeout(r, 20))
    expect(adjudicate).toHaveBeenCalledTimes(1)

    control.resume()
    await run
    expect(adjudicate).toHaveBeenCalledTimes(4)
  })

  it('stops at the next boundary when told to quit', async () => {
    const control = createRunControl()
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      control.stop()
      return ok(batch)
    })
    await auditEntries({ entries: four(), ...base({ batchSize: 1 }), adjudicate, control })
    expect(adjudicate).toHaveBeenCalledTimes(1)
  })

  // The caller needs the exact number to report, not an estimate: entries it never
  // attempted must never be counted approvable.
  it('says exactly how many entries it never got to', async () => {
    const control = createRunControl()
    const stopped: number[] = []
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      control.stop()
      return ok(batch)
    })
    await auditEntries({
      entries: four(),
      ...base({ batchSize: 1 }),
      adjudicate,
      control,
      onStopped: (pending: number) => stopped.push(pending),
    })
    expect(stopped).toEqual([3])
  })

  it('says nothing about stopping on a run that finished', async () => {
    const stopped: number[] = []
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => ok(batch))
    await auditEntries({
      entries: four(),
      ...base({ batchSize: 1 }),
      adjudicate,
      control: createRunControl(),
      onStopped: (pending: number) => stopped.push(pending),
    })
    expect(stopped).toEqual([])
  })

  it('returns only the verdicts it actually decided', async () => {
    const control = createRunControl()
    const adjudicate = vi.fn().mockImplementation(async (batch: { id: number }[]) => {
      control.stop()
      return ok(batch)
    })
    const verdicts = await auditEntries({ entries: four(), ...base({ batchSize: 1 }), adjudicate, control })
    expect(verdicts.map((v) => v.key)).toEqual(['k0'])
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
  // Interpolated for German, "German does not use English Title Case" is simply
  // false, so the guidance has to follow the profile rather than the language name.
  it('omits the title-case guidance for a locale whose profile does not run it', () => {
    const prompt = buildAuditPrompt(candidates, 'de', 2)
    expect(prompt).not.toMatch(/does NOT use English Title Case/i)
    expect(prompt).not.toMatch(/mirrors the English source/i)
    expect(prompt).toContain('glossary_lookup')
    expect(prompt).toMatch(/placeholder/i)
  })

  it('keeps the title-case guidance for Turkish', () => {
    expect(buildAuditPrompt(candidates, 'tr', 2)).toMatch(/does NOT use English Title Case/i)
  })

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

  // The one check that was already decided mechanically must not be handed over
  // as one that was not: the model would adjudicate a settled repair, and the
  // pre-batch suspect count would include it.
  it('keeps the mechanical repair out of the checks it asks the model to adjudicate', () => {
    const prompt = buildAuditPrompt(
      [
        {
          id: 1,
          key: 'a',
          msgid: 'Save ',
          msgstr: ['Kaydet '],
          comments: [],
          references: [],
          hints: [{ rule: 'repaired', severity: 'suspect' as const, message: 'whitespace restored to match the source' }],
          repaired: { text: ['Kaydet '], repairedBy: 'rules' as const },
        },
      ],
      'tr',
      2,
    )
    expect(prompt).not.toContain('automatedChecks":')
    expect(prompt).toContain('"alreadyRepaired":true')
    expect(prompt).toMatch(/alreadyRepaired.*whitespace/i)
  })

  // The asymmetry is defined in code as severity === 'error'. Naming the rules in
  // prose instead means a new error rule silently stops being treated as settled.
  it('marks a condemned entry in the payload and phrases the instruction off it', () => {
    const prompt = buildAuditPrompt(
      [
        {
          id: 1,
          key: 'b',
          msgid: '%s comments',
          msgstr: ['yorumlar'],
          comments: [],
          references: [],
          hints: [{ rule: 'placeholder', severity: 'error' as const, message: 'lost %s' }],
          condemned: [{ rule: 'placeholder', severity: 'error' as const, message: 'lost %s' }],
        },
      ],
      'tr',
      2,
    )
    expect(prompt).toContain('"condemned":true')
    expect(prompt).toMatch(/"condemned"[\s\S]*already known to be broken/)
    expect(prompt).not.toMatch(/reports a placeholder, html or plural-count problem/)
  })

  it('asks the model for a corrected translation', () => {
    const prompt = buildAuditPrompt(
      [{ id: 1, key: 'a', msgid: 'Save', msgstr: ['Kaydet'], comments: [], references: [], hints: [] }],
      'tr',
      2,
    )
    expect(prompt).toMatch(/"fix"/)
    expect(prompt).toMatch(/leave "fix" out/i)
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

  it('carries a proposed fix through', () => {
    const payload = { results: [{ id: 1, problem: true, categories: ['placeholder'], reason: 'x', fix: ['%s yorum'] }] }
    expect(mapAuditResults([{ id: 1, key: 'a' }], payload)[0]).toMatchObject({ fix: ['%s yorum'] })
  })

  // Declining is a first-class answer, not a malformed response.
  it('accepts a result with no fix at all', () => {
    const payload = { results: [{ id: 1, problem: true, categories: ['meaning'], reason: 'x' }] }
    expect(mapAuditResults([{ id: 1, key: 'a' }], payload)[0]?.fix).toBeUndefined()
  })

  it('rejects a fix that is not an array of strings', () => {
    const payload = { results: [{ id: 1, problem: true, categories: [], reason: 'x', fix: 'just a string' }] }
    expect(() => mapAuditResults([{ id: 1, key: 'a' }], payload)).toThrow(/schema validation/)
  })
})
