import { describe, expect, it } from 'vitest'
import { configHash, draftHash, srcHash, translateConfigHash } from '../../src/jobs/hash.js'
import type { AuditEntry, GlossaryEntry } from '../../src/types.js'

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  key: 'Save',
  msgid: 'Save',
  msgstr: ['Kaydet'],
  comments: [],
  references: [],
  fuzzy: false,
  ...over,
})

const term = (sourceTerm: string, translation: string): GlossaryEntry => ({
  sourceTerm,
  translation,
  locale: 'tr',
})

const config = (glossary: GlossaryEntry[], properNouns: string[] = []) => ({
  locale: 'tr' as const,
  glossary,
  properNouns,
})

describe('srcHash', () => {
  it('is stable for the same entry', () => {
    expect(srcHash(entry())).toBe(srcHash(entry()))
  })

  it('is 16 hex characters, matching the existing fingerprint format', () => {
    expect(srcHash(entry())).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when the translation changes', () => {
    expect(srcHash(entry({ msgstr: ['Kaydet'] }))).not.toBe(srcHash(entry({ msgstr: ['Sakla'] })))
  })

  it('changes when the source changes', () => {
    expect(srcHash(entry({ msgid: 'Save' }))).not.toBe(srcHash(entry({ msgid: 'Store' })))
  })

  it('separates context from source, so concatenation cannot collide', () => {
    const a = entry({ msgid: 'ab', msgctxt: 'c' })
    const b = entry({ msgid: 'a', msgctxt: 'bc' })
    expect(srcHash(a)).not.toBe(srcHash(b))
  })

  it('covers every plural form, not just the first', () => {
    const a = entry({ msgidPlural: '%d items', msgstr: ['%d oge', '%d oge'] })
    const b = entry({ msgidPlural: '%d items', msgstr: ['%d oge', '%d ogeler'] })
    expect(srcHash(a)).not.toBe(srcHash(b))
  })

  it('ignores the comments, which do not change what was said', () => {
    expect(srcHash(entry({ comments: [] }))).toBe(srcHash(entry({ comments: ['translators: a note'] })))
  })
})

describe('configHash', () => {
  it('is stable for the same configuration', () => {
    const g = [term('Settings', 'Ayarlar')]
    expect(configHash(config(g))).toBe(configHash(config(g)))
  })

  it('changes when a glossary term changes', () => {
    expect(configHash(config([term('ID', 'kimlik')]))).not.toBe(configHash(config([term('ID', 'ID')])))
  })

  it('changes when the proper noun list changes', () => {
    expect(configHash(config([], []))).not.toBe(configHash(config([], ['WooCommerce'])))
  })

  it('does not depend on the entries being reviewed', () => {
    // Only the entry's own src_hash may vary per entry; config_hash is per run.
    const g = [term('Settings', 'Ayarlar')]
    expect(configHash(config(g))).toBe(configHash(config(g)))
  })
})

describe('translateConfigHash', () => {
  it('is stable, and does not depend on the glossary the audit prompt uses', () => {
    expect(translateConfigHash('tr')).toBe(translateConfigHash('tr'))
  })

  it('differs from the audit configuration hash, which is why they prune separately', () => {
    expect(translateConfigHash('tr')).not.toBe(configHash(config([term('ID', 'kimlik')])))
  })
})

describe('draftHash', () => {
  it('changes with the draft text', () => {
    expect(draftHash(['Kaydet'])).not.toBe(draftHash(['Sakla']))
  })

  it('covers every plural form', () => {
    expect(draftHash(['a', 'b'])).not.toBe(draftHash(['a', 'c']))
  })
})
