import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localeRulesFile } from '../../src/rules/load.js'
import { localeSupport, supportNotice } from '../../src/rules/support.js'

describe('localeSupport', () => {
  it('describes a locale with a pack and no file', () => {
    expect(localeSupport('sv')).toEqual({ pack: { language: 'sv', status: 'defaults' }, file: false, universalOnly: false })
  })

  it('describes a locale with neither', () => {
    expect(localeSupport('de')).toEqual({ file: false, universalOnly: true })
  })

  it('sees a file that adds a check', async () => {
    const file = localeRulesFile('de')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'mistakes:\n  - wrong: Email\n', 'utf8')
    expect(localeSupport('de')).toEqual({ file: true, universalOnly: false })
  })
})

describe('supportNotice', () => {
  it('speaks up for a universal-only locale', () => {
    expect(supportNotice('de')).toBe('Note: no locale rules for de; only the universal checks run. Add some with: polyglots rules edit de')
  })

  it('stays quiet for Turkish and Swedish', () => {
    expect(supportNotice('tr')).toBeUndefined()
    expect(supportNotice('sv')).toBeUndefined()
  })
})
