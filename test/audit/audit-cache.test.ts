import { describe, expect, it, vi } from 'vitest'
import { auditEntries, type Adjudicator } from '../../src/audit/audit.js'
import type { CachedVerdict, VerdictKey } from '../../src/jobs/verdicts.js'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'

const glossary: GlossaryEntry[] = [{ sourceTerm: 'Settings', translation: 'Ayarlar', locale: 'tr' }]

const entry = (key: string, msgstr: string): AuditEntry => ({
  key,
  msgid: key,
  msgstr: [msgstr],
  comments: [],
  references: [],
  fuzzy: false,
})

function memoryCache() {
  const rows = new Map<string, CachedVerdict>()
  const id = (k: VerdictKey) => [k.srcHash, k.configHash, k.locale, k.engine].join('|')
  return {
    rows,
    get: (k: VerdictKey) => rows.get(id(k)),
    put: (k: VerdictKey, v: CachedVerdict) => void rows.set(id(k), v),
  }
}

const clean: Adjudicator = async (batch) =>
  batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: '' }))

const base = {
  locale: 'tr' as const,
  nplurals: 2,
  glossary,
  configHash: 'cfg0cfg0cfg0cfg0',
  engine: 'claude',
}

describe('auditEntries with a verdict cache', () => {
  it('writes a verdict for every entry the model judged', async () => {
    const store = memoryCache()
    await auditEntries({ ...base, entries: [entry('Save', 'Kaydet')], store, adjudicate: clean })
    expect(store.rows.size).toBe(1)
  })

  it('does not ask the model about an entry already in the cache', async () => {
    const store = memoryCache()
    const adjudicate = vi.fn(clean)
    const entries = [entry('Save', 'Kaydet')]
    await auditEntries({ ...base, entries, store, adjudicate })
    expect(adjudicate).toHaveBeenCalledTimes(1)

    adjudicate.mockClear()
    await auditEntries({ ...base, entries, store, adjudicate })
    expect(adjudicate).not.toHaveBeenCalled()
  })

  it('reaches the same verdict from the cache as from the model', async () => {
    const store = memoryCache()
    const entries = [entry('Save', 'Kaydet')]
    const first = await auditEntries({ ...base, entries, store, adjudicate: clean })
    const second = await auditEntries({ ...base, entries, store, adjudicate: clean })
    expect(second).toEqual(first)
  })

  it('asks only about the entries that changed', async () => {
    const store = memoryCache()
    const adjudicate = vi.fn(clean)
    await auditEntries({
      ...base,
      entries: [entry('Save', 'Kaydet'), entry('Cancel', 'Iptal')],
      store,
      adjudicate,
    })

    adjudicate.mockClear()
    await auditEntries({
      ...base,
      entries: [entry('Save', 'Kaydet'), entry('Cancel', 'Vazgec')],
      store,
      adjudicate,
    })
    const asked = adjudicate.mock.calls.flatMap(([batch]) => batch.map((c) => c.key))
    expect(asked).toEqual(['Cancel'])
  })

  it('does not cache a failed batch, so a retry re-asks', async () => {
    const store = memoryCache()
    const failing: Adjudicator = async () => {
      throw new Error('quota exhausted')
    }
    await auditEntries({ ...base, entries: [entry('Save', 'Kaydet')], store, adjudicate: failing })
    expect(store.rows.size).toBe(0)
  })

  it('caches the entries a partly failed run did judge', async () => {
    // One batch succeeds, the next fails. The successful batch's verdicts are
    // worth keeping: re-asking about them is what the cache exists to prevent.
    const store = memoryCache()
    let call = 0
    const flaky: Adjudicator = async (batch) => {
      call += 1
      if (call > 1) throw new Error('quota exhausted')
      return batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: '' }))
    }
    await auditEntries({
      ...base,
      entries: [entry('A', 'a'), entry('B', 'b')],
      batchSize: 1,
      store,
      adjudicate: flaky,
    })
    expect(store.rows.size).toBe(1)
  })

  it('hands over the verdicts it answered from the cache', async () => {
    const store = memoryCache()
    const entries = [entry('Save', 'Kaydet')]
    await auditEntries({ ...base, entries, store, adjudicate: clean })

    const cached: string[] = []
    await auditEntries({
      ...base,
      entries,
      store,
      adjudicate: clean,
      onCached: (verdicts) => void cached.push(...verdicts.map((v) => v.key)),
    })
    expect(cached).toEqual(['Save'])
  })

  it('does not call onCached on a first run, which answers nothing from cache', async () => {
    const onCached = vi.fn()
    await auditEntries({ ...base, entries: [entry('Save', 'Kaydet')], store: memoryCache(), adjudicate: clean, onCached })
    expect(onCached).not.toHaveBeenCalled()
  })

  it('behaves exactly as before when no store is given', async () => {
    const adjudicate = vi.fn(clean)
    const entries = [entry('Save', 'Kaydet')]
    const first = await auditEntries({ ...base, entries, adjudicate })
    const second = await auditEntries({ ...base, entries, adjudicate })
    expect(adjudicate).toHaveBeenCalledTimes(2)
    expect(second).toEqual(first)
  })
})
