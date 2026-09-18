import { describe, expect, it } from 'vitest'
import { MARKER_HEADER, encodeMarker, fingerprintReview, type ReviewMarker } from '../../src/audit/resume.js'
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
  it('is one header line, since a .po header cannot hold a newline', () => {
    expect(encodeMarker(MARKER)).not.toContain('\n')
  })

  it('names itself so a human reading the file can tell what it is', () => {
    expect(MARKER_HEADER).toMatch(/^X-/)
  })
})

describe('fingerprintReview', () => {
  it('is stable across calls with the same inputs', () => {
    expect(fingerprintReview({ ...INPUT })).toEqual(fingerprintReview(INPUT))
  })
})
