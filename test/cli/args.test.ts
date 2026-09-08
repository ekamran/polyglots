import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageError, expandFileArgs, parseLocaleArg, parsePositiveInt, parseSecretName } from '../../src/cli/args.js'

describe('expandFileArgs', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'polyglots-cli-args-'))
    await writeFile(join(dir, 'a.po'), '')
    await writeFile(join(dir, 'b.po'), '')
    await writeFile(join(dir, 'notes.txt'), '')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('expands glob patterns and sorts matches', () => {
    expect(expandFileArgs([join(dir, '*.po')])).toEqual([join(dir, 'a.po'), join(dir, 'b.po')])
  })

  it('passes literal existing paths through and dedupes', () => {
    const a = join(dir, 'a.po')
    expect(expandFileArgs([a, a, join(dir, '*.po')])).toEqual([a, join(dir, 'b.po')])
  })

  it('throws a UsageError naming the pattern when a glob matches nothing', () => {
    expect(() => expandFileArgs([join(dir, '*.pot')])).toThrow(UsageError)
    expect(() => expandFileArgs([join(dir, '*.pot')])).toThrow(/No files match/)
    expect(() => expandFileArgs([join(dir, '*.pot')])).toThrow('*.pot')
  })

  it('throws a UsageError when a literal path does not exist', () => {
    expect(() => expandFileArgs([join(dir, 'missing.po')])).toThrow(UsageError)
    expect(() => expandFileArgs([join(dir, 'missing.po')])).toThrow(/missing\.po/)
  })

  it('rejects a directory as a usage error instead of letting it reach the parser', async () => {
    await mkdir(join(dir, 'sub'))
    expect(() => expandFileArgs([join(dir, 'sub')])).toThrow(UsageError)
    expect(() => expandFileArgs([join(dir, 'sub')])).toThrow(/Not a file/)
  })

  it('drops directories from glob matches', async () => {
    await mkdir(join(dir, 'c.po'))
    expect(expandFileArgs([join(dir, '*.po')])).toEqual([join(dir, 'a.po'), join(dir, 'b.po')])
    expect(() => expandFileArgs([join(dir, 'c.p?')])).toThrow(/No files match/)
  })

  it('treats an existing path containing glob characters as a literal file', async () => {
    const odd = join(dir, 'weird [v2].po')
    await writeFile(odd, '')
    expect(expandFileArgs([odd])).toEqual([odd])
  })
})

describe('parsePositiveInt', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveInt('--batch-size', '10')).toBe(10)
  })

  it('rejects zero, negatives, fractions and junk with a UsageError', () => {
    for (const bad of ['0', '-3', '2.5', 'ten', '']) {
      expect(() => parsePositiveInt('--batch-size', bad)).toThrow(UsageError)
      expect(() => parsePositiveInt('--batch-size', bad)).toThrow('--batch-size')
    }
  })
})

describe('parseLocaleArg', () => {
  it('normalizes to lowercase dash form', () => {
    expect(parseLocaleArg(' TR ')).toBe('tr')
    expect(parseLocaleArg('PT-BR')).toBe('pt-br')
  })

  it('rejects an empty locale', () => {
    expect(() => parseLocaleArg('  ')).toThrow(UsageError)
  })

  it('rejects WordPress locale codes that are not translate.wordpress.org slugs', () => {
    for (const bad of ['tr_TR', 'tr-TR', 'de_DE']) {
      expect(() => parseLocaleArg(bad)).toThrow(UsageError)
      expect(() => parseLocaleArg(bad)).toThrow(/translate\.wordpress\.org/)
    }
    expect(() => parseLocaleArg('tr_TR')).toThrow(/"tr"/)
  })
})

describe('parseSecretName', () => {
  it('accepts the two known secret names', () => {
    expect(parseSecretName('DEEPL_API_KEY')).toBe('DEEPL_API_KEY')
    expect(parseSecretName('OPENAI_API_KEY')).toBe('OPENAI_API_KEY')
  })

  it('rejects anything else', () => {
    expect(() => parseSecretName('deepl')).toThrow(UsageError)
    expect(() => parseSecretName('PATH')).toThrow(/DEEPL_API_KEY|OPENAI_API_KEY/)
  })
})
