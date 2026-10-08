import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { openDb, upsertTm } from '../../../src/storage/index.js'
import { translateFile, type TranslateOptions } from '../../../src/commands/translate.js'
import { collect, fakeEngine, fakeReview, makeWorkspace, ofType, PENDING_KEYS, type Workspace } from './helpers.js'

let ws: Workspace

beforeEach(async () => {
  ws = await makeWorkspace()
})

afterEach(async () => {
  await ws.cleanup()
})

function base(overrides: Partial<TranslateOptions> = {}): TranslateOptions {
  return {
    file: ws.file,
    locale: 'tr',
    mode: 'pending',
    draftEngine: 'deepl',
    mcpConfigPath: join(ws.home, 'mcp.json'),
    batchSize: 25,
    ...overrides,
  }
}

describe('translateFile: per-entry events', () => {
  it('names every entry of a batch as it lands, before the batch closes', async () => {
    const review = fakeReview()
    review.fuzzyKeys.add('Form entries')
    const { events, onProgress } = collect()

    await translateFile(base({ engine: fakeEngine(), review, onProgress }))

    const landed = ofType(events, 'entries')
    expect(landed).toHaveLength(1)
    expect(landed[0]!.entries.map((e) => e.key)).toEqual(PENDING_KEYS)
    expect(landed[0]!.entries.find((e) => e.key === 'Save Changes')).toEqual({
      key: 'Save Changes',
      msgid: 'Save Changes',
      outcome: 'drafted',
    })
    expect(landed[0]!.entries.find((e) => e.key === 'Form entries')).toMatchObject({ outcome: 'fuzzy', from: 'engine' })
    // The msgid alone, never the context glued onto the key.
    expect(landed[0]!.entries.find((e) => e.key === PENDING_KEYS[2])).toMatchObject({ msgid: 'Form' })

    const types = events.map((e) => e.type)
    expect(types.indexOf('entries')).toBeLessThan(types.indexOf('batch-done'))
  })

  it('says which entries came from the memory', async () => {
    const db = openDb(join(ws.home, 'tm.db'))
    upsertTm(db, [{ source: 'Save Changes', target: 'Değişiklikleri Kaydet', locale: 'tr' }])
    upsertTm(db, [{ source: 'Thank you for installing %s.', target: '%s kurduğunuz için teşekkürler.', locale: 'tr' }])
    upsertTm(db, [{ source: 'Thank you for installing %s.', target: '%s yüklediğiniz için teşekkürler.', locale: 'tr' }])
    const { events, onProgress } = collect()

    await translateFile(base({ db, engine: fakeEngine(), review: fakeReview(), onProgress }))
    db.close()

    const memory = ofType(events, 'entries')[0]!
    expect(memory.entries).toEqual([
      { key: 'Save Changes', msgid: 'Save Changes', outcome: 'memory' },
      // Two approved wordings, so the entry is written fuzzy for a human to pick.
      { key: 'Thank you for installing %s.', msgid: 'Thank you for installing %s.', outcome: 'fuzzy', from: 'memory' },
    ])
    const types = events.map((e) => e.type)
    expect(types.indexOf('entries')).toBe(types.indexOf('tm-hit') + 1)
  })

  it('marks a skipped batch entry by entry', async () => {
    const engine = fakeEngine()
    engine.failWith = () => new Error('engine down')
    const { events, onProgress } = collect()

    await translateFile(base({ engine, review: fakeReview(), onProgress }))

    const landed = ofType(events, 'entries').flatMap((e) => e.entries)
    expect(landed).toHaveLength(PENDING_KEYS.length)
    expect(new Set(landed.map((e) => e.outcome))).toEqual(new Set(['skipped']))
  })

  it('shortens a long msgid for display', async () => {
    const { events, onProgress } = collect()
    await translateFile(base({ engine: fakeEngine(), review: fakeReview(), onProgress }))

    const long = ofType(events, 'entries')
      .flatMap((e) => e.entries)
      .find((e) => e.key.startsWith('Drag fields'))!
    expect(long.msgid.length).toBeLessThanOrEqual(80)
    expect(long.msgid.endsWith('…')).toBe(true)
  })
})
