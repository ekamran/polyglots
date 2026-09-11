import { describe, expect, it } from 'vitest'
import {
  MARKER_HEADER,
  decodeMarker,
  describeMismatch,
  encodeMarker,
  fingerprintReview,
  type ReviewMarker,
} from '../../src/audit/resume.js'
import type { GlossaryEntry } from '../../src/types.js'

const GLOSSARY: GlossaryEntry[] = [{ locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu' }]

const INPUT = {
  source: 'msgid "Save"\nmsgstr "Kaydet"\n',
  locale: 'tr',
  batchSize: 25,
  noAi: false,
  glossary: GLOSSARY,
  properNouns: ['Türk Dil Kurumu'],
}

const MARKER: ReviewMarker = {
  fingerprint: fingerprintReview(INPUT),
  done: 42,
  of: 114,
  problems: 57,
  unreviewed: 25,
  repaired: 19,
  byRule: { 'ai:meaning': 30, glossary: 27 },
}

describe('review marker', () => {
  it('round-trips through a header value', () => {
    expect(decodeMarker(encodeMarker(MARKER))).toEqual(MARKER)
  })

  it('is one header line, since a .po header cannot hold a newline', () => {
    expect(encodeMarker(MARKER)).not.toContain('\n')
  })

  it('names itself so a human reading the file can tell what it is', () => {
    expect(MARKER_HEADER).toMatch(/^X-/)
  })

  it('reads nothing from a file that carries no marker', () => {
    expect(decodeMarker(undefined)).toBeUndefined()
  })

  // A hand-edited or truncated header must not crash a review or, worse, resume
  // from a number it made up.
  it('reads nothing from a damaged marker rather than guessing', () => {
    expect(decodeMarker('{"done":')).toBeUndefined()
    expect(decodeMarker('not json at all')).toBeUndefined()
    expect(decodeMarker('{"done":"lots"}')).toBeUndefined()
    expect(decodeMarker(encodeMarker(MARKER).replace(/"v":1/, '"v":2'))).toBeUndefined()
    // A marker written before repairs were counted: resuming from it would report
    // a repair count short by everything the earlier run fixed.
    expect(decodeMarker(encodeMarker(MARKER).replace(/,"repaired":\d+/, ''))).toBeUndefined()
  })

  it('reads nothing from a marker whose fingerprint is not a fingerprint', () => {
    expect(decodeMarker(JSON.stringify({ v: 1, ...MARKER, fingerprint: 'abc' }))).toBeUndefined()
  })
})

describe('fingerprintReview', () => {
  it('is stable across calls with the same inputs', () => {
    expect(fingerprintReview({ ...INPUT })).toEqual(fingerprintReview(INPUT))
  })
})

describe('describeMismatch', () => {
  const same = (overrides: Partial<typeof INPUT>) =>
    describeMismatch(fingerprintReview(INPUT), fingerprintReview({ ...INPUT, ...overrides }))

  it('says nothing when the run is the same one', () => {
    expect(same({})).toBeUndefined()
  })

  it('names the submission when the file itself changed', () => {
    expect(same({ source: INPUT.source + '\n' })).toMatch(/submission/i)
  })

  it('names the glossary when the terms behind the rules changed', () => {
    const glossary = [...GLOSSARY, { locale: 'tr', sourceTerm: 'post', translation: 'yazı' }]
    expect(same({ glossary })).toMatch(/glossary/i)
  })

  // Batch size decides where the batch boundaries fall, so a resume across a
  // change would skip the wrong entries entirely.
  it('names the batch size, with both values, when it changed', () => {
    expect(same({ batchSize: 50 })).toMatch(/batch size.*25.*50/i)
  })

  it('names the rules when the proper-noun list changed', () => {
    expect(same({ properNouns: [] })).toMatch(/rules|guidance/i)
  })

  it('names the rules when the locale changed', () => {
    expect(same({ locale: 'de' })).toMatch(/locale|rules|guidance/i)
  })

  it('separates a rules-only run from one the model adjudicated', () => {
    expect(same({ noAi: true })).toMatch(/AI|model/i)
  })

  // The first difference is enough to refuse; listing all of them buries it.
  it('reports one reason, not a list', () => {
    expect(same({ source: 'different', batchSize: 50 })?.split('\n')).toHaveLength(1)
  })
})
