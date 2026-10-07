import { describe, expect, it } from 'vitest'
import { builtInProfileFor } from '../../src/audit/rules/profiles.js'
import { builtInProperNounsFor } from '../../src/audit/rules/proper-nouns.js'
import { renderDefaultRules } from '../../src/rules/defaults.js'
import { rulesFingerprint } from '../../src/rules/load.js'
import { parseLocaleRules } from '../../src/rules/load.js'
import { UNIVERSAL_RULES } from '../../src/audit/rules/profiles.js'

describe('renderDefaultRules', () => {
  // The file written for editing must describe exactly what runs today, or the
  // first edit would silently change rules the person never touched.
  it('describes the built-in Turkish profile and names exactly, once uncommented', () => {
    const rules = parseLocaleRules(renderDefaultRules('tr', { commented: false }), 'tr.yaml')
    const active = new Set([...UNIVERSAL_RULES, ...rules.rules!.enable].filter((r) => !rules.rules!.disable.includes(r)))
    expect([...active].sort()).toEqual([...builtInProfileFor('tr').rules].sort())
    expect(rules.glossaryStemRatio).toBe(builtInProfileFor('tr').glossaryStemRatio)
    expect(rules.properNouns).toEqual(builtInProperNounsFor('tr'))
  })

  it('describes the universal profile for a locale without built-in extras', () => {
    const rules = parseLocaleRules(renderDefaultRules('de', { commented: false }), 'de.yaml')
    expect(rules.rules).toEqual({ enable: [], disable: [] })
  })

  // Written as comments, the file changes nothing until something is uncommented.
  it('is a valid file that sets nothing when commented', () => {
    const rules = parseLocaleRules(renderDefaultRules('tr'), 'tr.yaml')
    expect(rulesFingerprint(rules)).toBe('')
  })

  it('shows an example of each section', () => {
    const text = renderDefaultRules('tr')
    for (const section of ['mistakes', 'patterns', 'guidance', 'level: fix']) expect(text).toContain(section)
  })
})
