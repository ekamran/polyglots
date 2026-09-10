import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configDir, configFile, secretsFile } from '../../src/paths.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadSecrets,
  maskSecret,
  saveConfig,
  saveSecret,
} from '../../src/config.js'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'polyglots-config-'))
  process.env.POLYGLOTS_HOME = home
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
})

afterEach(async () => {
  delete process.env.POLYGLOTS_HOME
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
  await rm(home, { recursive: true, force: true })
})

async function writeConfigRaw(text: string): Promise<void> {
  await mkdir(configDir(), { recursive: true })
  await writeFile(configFile(), text)
}

async function writeSecretsRaw(text: string): Promise<void> {
  await mkdir(configDir(), { recursive: true })
  await writeFile(secretsFile(), text)
}

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

describe('loadConfig', () => {
  it('returns defaults when no file exists', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG).toEqual({
      defaultLocale: 'tr',
      defaultDraftEngine: 'deepl',
      batchSize: 25,
      consistencyTtlDays: 30,
      properNouns: {},
    })
  })

  it('merges a partial file over defaults and ignores unknown keys', async () => {
    await writeConfigRaw(JSON.stringify({ batchSize: 10, unknownKey: 'x' }))
    const cfg = loadConfig()
    expect(cfg).toEqual({ ...DEFAULT_CONFIG, batchSize: 10 })
    expect('unknownKey' in cfg).toBe(false)
  })

  it('throws a clear error naming the path on invalid JSON', async () => {
    await writeConfigRaw('{ not json')
    expect(() => loadConfig()).toThrow(configFile())
  })

  it('throws on wrong types', async () => {
    await writeConfigRaw(JSON.stringify({ batchSize: 'ten' }))
    expect(() => loadConfig()).toThrow(/batchSize/)
  })

  it('rejects null, array and non-integer batchSize', async () => {
    for (const bad of [null, [5], 2.5, 0, -1]) {
      await writeConfigRaw(JSON.stringify({ batchSize: bad }))
      expect(() => loadConfig()).toThrow(/batchSize/)
    }
  })

  it('rejects a config file that is not an object', async () => {
    await writeConfigRaw('[1, 2]')
    expect(() => loadConfig()).toThrow(/JSON object/)
    await writeConfigRaw('null')
    expect(() => loadConfig()).toThrow(/JSON object/)
  })

  it('rejects an unsupported draft engine', async () => {
    await writeConfigRaw(JSON.stringify({ defaultDraftEngine: 'google' }))
    expect(() => loadConfig()).toThrow(/defaultDraftEngine/)
  })
})

describe('saveConfig', () => {
  it('writes a merged config that round-trips through loadConfig', async () => {
    const saved = saveConfig({ defaultDraftEngine: 'openai', batchSize: 5 })
    expect(saved).toEqual({ ...DEFAULT_CONFIG, defaultDraftEngine: 'openai', batchSize: 5 })
    expect(loadConfig()).toEqual(saved)

    const raw = await readFile(configFile(), 'utf8')
    expect(raw).toContain('\n  "batchSize": 5')
    expect(await modeOf(configFile())).toBe(0o600)
  })

  it('preserves previously saved keys when patching again', () => {
    saveConfig({ batchSize: 7 })
    saveConfig({ defaultLocale: 'de' })
    expect(loadConfig()).toEqual({ ...DEFAULT_CONFIG, batchSize: 7, defaultLocale: 'de' })
  })

  it('keeps unknown keys from the file so newer settings survive an older binary', async () => {
    await writeConfigRaw(JSON.stringify({ batchSize: 5, future: { nested: true } }))
    saveConfig({ defaultLocale: 'de' })
    const raw = JSON.parse(await readFile(configFile(), 'utf8'))
    expect(raw).toEqual({ ...DEFAULT_CONFIG, batchSize: 5, defaultLocale: 'de', future: { nested: true } })
    expect(loadConfig()).toEqual({ ...DEFAULT_CONFIG, batchSize: 5, defaultLocale: 'de' })
  })

  it('tightens a pre-existing world-readable file to 0600', async () => {
    await writeConfigRaw(JSON.stringify({ batchSize: 5 }))
    await chmod(configFile(), 0o644)
    expect(await modeOf(configFile())).toBe(0o644)
    saveConfig({ batchSize: 6 })
    expect(await modeOf(configFile())).toBe(0o600)
  })

  it('throws on an invalid patch and leaves the existing file untouched', async () => {
    const original = JSON.stringify({ batchSize: 5 })
    await writeConfigRaw(original)
    expect(() => saveConfig({ batchSize: -3 })).toThrow(/batchSize/)
    expect(() => saveConfig({ defaultDraftEngine: 'google' as never })).toThrow(/defaultDraftEngine/)
    expect(await readFile(configFile(), 'utf8')).toBe(original)
  })

  it('leaves no temp file behind after writing', async () => {
    saveConfig({ batchSize: 5 })
    expect(await readdir(configDir())).toEqual(['config.json'])
  })
})

describe('loadSecrets', () => {
  it('returns undefined values when nothing is configured', () => {
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: undefined, OPENAI_API_KEY: undefined })
  })

  it('reads from the secrets file without mutating process.env', async () => {
    await writeSecretsRaw('# keys\nDEEPL_API_KEY=file-deepl\nOTHER=ignored\n')
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: 'file-deepl', OPENAI_API_KEY: undefined })
    expect(process.env.DEEPL_API_KEY).toBeUndefined()
    expect(process.env.OTHER).toBeUndefined()
  })

  it('lets process.env override the file', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=file-deepl\nOPENAI_API_KEY=file-openai\n')
    process.env.DEEPL_API_KEY = 'env-deepl'
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: 'env-deepl', OPENAI_API_KEY: 'file-openai' })
  })

  it('treats empty values as unset', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=\n')
    process.env.OPENAI_API_KEY = ''
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: undefined, OPENAI_API_KEY: undefined })
  })
})

describe('saveSecret', () => {
  it('creates the file with mode 0600 when missing', async () => {
    saveSecret('DEEPL_API_KEY', 'abc')
    expect(await modeOf(secretsFile())).toBe(0o600)
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=abc\n')
  })

  it('tightens a pre-existing world-readable file to 0600', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=old\n')
    await chmod(secretsFile(), 0o644)
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await modeOf(secretsFile())).toBe(0o600)
  })

  it('leaves no temp file behind after writing', async () => {
    saveSecret('DEEPL_API_KEY', 'abc')
    expect(await readdir(configDir())).toEqual(['.env'])
  })

  it('upserts in place, preserving other lines and comments', async () => {
    await writeSecretsRaw('# polyglots secrets\nDEEPL_API_KEY=old\n\n# openai below\nOPENAI_API_KEY=keep\n')
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await readFile(secretsFile(), 'utf8')).toBe(
      '# polyglots secrets\nDEEPL_API_KEY=new\n\n# openai below\nOPENAI_API_KEY=keep\n',
    )
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: 'new', OPENAI_API_KEY: 'keep' })
  })

  it('appends when the key is absent, keeping existing content', async () => {
    await writeSecretsRaw('# comment\nOPENAI_API_KEY=keep')
    saveSecret('DEEPL_API_KEY', 'added')
    expect(await readFile(secretsFile(), 'utf8')).toBe(
      '# comment\nOPENAI_API_KEY=keep\nDEEPL_API_KEY=added\n',
    )
  })

  it('normalizes CRLF files to LF instead of mixing endings', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=old\r\nOPENAI_API_KEY=keep\r\n')
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=new\nOPENAI_API_KEY=keep\n')
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: 'new', OPENAI_API_KEY: 'keep' })
  })

  it('replaces the colon-separated form dotenv also accepts', async () => {
    await writeSecretsRaw('DEEPL_API_KEY: old\n')
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=new\n')
  })

  it('drops later duplicates so the stale line cannot win under last-wins parsing', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=first\nOPENAI_API_KEY=keep\nDEEPL_API_KEY=stale\n')
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=new\nOPENAI_API_KEY=keep\n')
    expect(loadSecrets().DEEPL_API_KEY).toBe('new')
  })

  it('quotes values containing spaces or # so they round-trip', async () => {
    saveSecret('OPENAI_API_KEY', 'has space')
    expect(await readFile(secretsFile(), 'utf8')).toMatch(/^OPENAI_API_KEY=(['"`])has space\1\n$/)
    expect(loadSecrets().OPENAI_API_KEY).toBe('has space')

    saveSecret('OPENAI_API_KEY', 'a#b')
    expect(await readFile(secretsFile(), 'utf8')).toMatch(/^OPENAI_API_KEY=(['"`])a#b\1\n$/)
    expect(loadSecrets().OPENAI_API_KEY).toBe('a#b')
  })

  it('leaves plain values unquoted', async () => {
    saveSecret('DEEPL_API_KEY', 'abc-123:fx')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=abc-123:fx\n')
  })

  it('round-trips values containing quote characters', () => {
    for (const value of ['say "hi"', "it's", 'back`tick', `mix "and" 'both'`, `x\\n y'`, `x\\r y\``]) {
      saveSecret('OPENAI_API_KEY', value)
      expect(loadSecrets().OPENAI_API_KEY).toBe(value)
    }
  })

  it('rejects a value containing all three quote characters', () => {
    expect(() => saveSecret('OPENAI_API_KEY', `a'b"c\`d`)).toThrow(/quote/)
  })

  it('rejects a backslash escape that dotenv would expand inside double quotes', () => {
    expect(() => saveSecret('OPENAI_API_KEY', `x\\n y'\``)).toThrow(/backslash/)
    expect(() => saveSecret('OPENAI_API_KEY', `x\\r y'\``)).toThrow(/backslash/)
    expect(loadSecrets().OPENAI_API_KEY).toBeUndefined()
  })

  it('rejects control characters so a value cannot smuggle extra lines', async () => {
    for (const value of ['a\nOPENAI_API_KEY=injected', 'trailing\n', 'cr\rlf', 'tab\there', 'nul\0']) {
      expect(() => saveSecret('DEEPL_API_KEY', value)).toThrow(/control/)
    }
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: undefined, OPENAI_API_KEY: undefined })
  })

  it('writes KEY= for an empty value, which loadSecrets reports as unset', async () => {
    await writeSecretsRaw('DEEPL_API_KEY=old\nOPENAI_API_KEY=keep\n')
    saveSecret('DEEPL_API_KEY', '')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=\nOPENAI_API_KEY=keep\n')
    expect(loadSecrets()).toEqual({ DEEPL_API_KEY: undefined, OPENAI_API_KEY: 'keep' })
  })

  it('matches keys with surrounding whitespace or export prefix', async () => {
    await writeSecretsRaw('export DEEPL_API_KEY = old\n')
    saveSecret('DEEPL_API_KEY', 'new')
    expect(await readFile(secretsFile(), 'utf8')).toBe('DEEPL_API_KEY=new\n')
  })
})

describe('maskSecret', () => {
  it('reports unset for empty or undefined', () => {
    expect(maskSecret()).toBe('(not set)')
    expect(maskSecret('')).toBe('(not set)')
  })

  it('fully hides values shorter than 12 characters', () => {
    expect(maskSecret('abc')).toBe('••••')
    expect(maskSecret('12345678')).toBe('••••')
    expect(maskSecret('12345678901')).toBe('••••')
  })

  it('shows first 4 and last 2 chars of longer values', () => {
    expect(maskSecret('123456789012')).toBe('1234…12')
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-a…op')
  })
})
