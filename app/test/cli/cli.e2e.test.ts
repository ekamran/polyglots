import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const cliEntry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url))
const sampleTmx = fileURLToPath(new URL('../fixtures/tmx/sample.tmx', import.meta.url))
const samplePo = fileURLToPath(new URL('../fixtures/po/sample.po', import.meta.url))

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

let home: string

// Every test spawns node + tsx; three chained spawns on a cold CI runner can pass 5 s.
vi.setConfig({ testTimeout: 30_000 })

function runCli(args: string[], opts: { stdin?: string; env?: Record<string, string> } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, POLYGLOTS_HOME: home, ...opts.env }
    delete env.DEEPL_API_KEY
    delete env.OPENAI_API_KEY
    const child = spawn(process.execPath, [tsxCli, cliEntry, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
    child.stdin.end()
  })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'polyglots-cli-e2e-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('polyglots --help', () => {
  it('exits 0 and lists every command', async () => {
    const res = await runCli(['--help'])
    expect(res.code).toBe(0)
    for (const cmd of ['translate', 'tm', 'glossary', 'config']) {
      expect(res.stdout).toMatch(new RegExp(`^\\s+${cmd}\\b`, 'm'))
    }
  })

  it('documents nested commands', async () => {
    const tm = await runCli(['tm', '--help'])
    expect(tm.code).toBe(0)
    expect(tm.stdout).toMatch(/^\s+import\b/m)
    const config = await runCli(['config', '--help'])
    expect(config.stdout).toMatch(/^\s+get\b/m)
    expect(config.stdout).toMatch(/^\s+set\b/m)
    expect(config.stdout).toMatch(/^\s+set-key\b/m)
    const glossary = await runCli(['glossary', '--help'])
    expect(glossary.stdout).toMatch(/^\s+sync\b/m)
  })
})

describe('polyglots with no arguments', () => {
  it('dispatches to the TUI, which refuses a non-TTY stdin with exit 1', async () => {
    const res = await runCli([])
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/needs a terminal/)
    expect(res.stderr).toMatch(/polyglots --help/)
    expect(res.stdout).toBe('')
  })

  it('prints the package.json version', async () => {
    const res = await runCli(['--version'])
    expect(res.code).toBe(0)
    expect(res.stdout.trim()).toBe((require('../../package.json') as { version: string }).version)
  })
})

describe('usage errors', () => {
  it('exits 2 on an unknown command', async () => {
    const res = await runCli(['frobnicate'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/unknown command/i)
    expect(res.stdout).toBe('')
  })

  it('exits 2 on an unknown option', async () => {
    const res = await runCli(['translate', 'x.po', '--bogus'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/unknown option/i)
  })

  it('exits 2 when a glob matches nothing', async () => {
    const res = await runCli(['translate', join(home, 'nothing-here', '*.po')])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/No files match/)
    expect(res.stderr).toContain('*.po')
  })

  it('exits 2 when --all is used without --yes on a non-TTY', async () => {
    const file = join(home, 'sample.po')
    await copyFile(samplePo, file)
    const before = await readFile(file)
    const res = await runCli(['translate', file, '--all'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/--all requires --yes/)
    expect(await readFile(file)).toEqual(before)
  })

  it('exits 2 for a command group without a subcommand', async () => {
    const res = await runCli(['tm'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/import/)
  })

  it('exits 2 when translate gets no files', async () => {
    const res = await runCli(['translate'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/missing required argument/i)
  })

  it('exits 2 on a bad --batch-size', async () => {
    const file = join(home, 'sample.po')
    await copyFile(samplePo, file)
    const res = await runCli(['translate', file, '--batch-size', 'lots'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/--batch-size/)
  })

  it('exits 2 on a bad --draft-engine', async () => {
    const file = join(home, 'sample.po')
    await copyFile(samplePo, file)
    const res = await runCli(['translate', file, '--draft-engine', 'google'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/draft-engine/)
  })
})

describe('config', () => {
  it('round-trips a numeric setting', async () => {
    const set = await runCli(['config', 'set', 'batchSize', '10'])
    expect(set.code).toBe(0)
    const get = await runCli(['config', 'get', 'batchSize'])
    expect(get.code).toBe(0)
    expect(get.stdout.trim()).toBe('10')
    const raw = JSON.parse(await readFile(join(home, 'config', 'config.json'), 'utf8')) as { batchSize: unknown }
    expect(raw.batchSize).toBe(10)
  })

  it('rejects an invalid value and an unknown key with exit 2', async () => {
    const bad = await runCli(['config', 'set', 'batchSize', 'ten'])
    expect(bad.code).toBe(2)
    const unknown = await runCli(['config', 'set', 'colour', 'blue'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toMatch(/colour/)
    const getUnknown = await runCli(['config', 'get', 'colour'])
    expect(getUnknown.code).toBe(2)
  })

  it('refuses to store a secret through config set', async () => {
    const res = await runCli(['config', 'set', 'DEEPL_API_KEY', 'abc'])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/set-key/)
  })

  it('stores a key read from stdin and never echoes it back', async () => {
    const key = 'dpl-SECRET-1234567890-VALUE:fx'
    const set = await runCli(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: `${key}\n` })
    expect(set.code).toBe(0)
    expect(set.stdout + set.stderr).not.toContain(key)
    expect(set.stdout).toContain('DEEPL_API_KEY')

    const get = await runCli(['config', 'get', 'DEEPL_API_KEY'])
    expect(get.code).toBe(0)
    expect(get.stdout.trim()).toBe('dpl-…fx')
    expect(get.stdout + get.stderr).not.toContain(key)

    const all = await runCli(['config', 'get'])
    expect(all.code).toBe(0)
    expect(all.stdout).toContain('dpl-…fx')
    // Nothing is assumed until the person names a locale.
    expect(all.stdout).toContain('defaultLocale = (not set)')
    expect(all.stdout).toMatch(/OPENAI_API_KEY.*\(not set\)/)
    expect(all.stdout + all.stderr).not.toContain(key)

    const env = await readFile(join(home, 'config', '.env'), 'utf8')
    expect(env).toContain(`DEEPL_API_KEY=${key}`)
  })

  it('rejects an empty stdin key and an unknown key name', async () => {
    const empty = await runCli(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: '\n' })
    expect(empty.code).toBe(2)
    const unknown = await runCli(['config', 'set-key', 'GOOGLE_KEY', 'x'])
    expect(unknown.code).toBe(2)
  })
})

describe('translate (without an engine key)', () => {
  it('exits 1 naming the missing key before starting any work', async () => {
    const file = join(home, 'sample.po')
    await copyFile(samplePo, file)
    const before = await readFile(file)
    const res = await runCli(['translate', file])
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/DEEPL_API_KEY/)
    expect(res.stderr).not.toMatch(/Translating/)
    expect(res.stdout).toBe('')
    expect(await readFile(file)).toEqual(before)
  })

  it('does not write TM hits before failing on the missing key', async () => {
    const file = join(home, 'sample.po')
    await copyFile(samplePo, file)
    const before = await readFile(file)
    const imported = await runCli(['tm', 'import', sampleTmx, '--locale', 'tr'])
    expect(imported.code).toBe(0)
    const res = await runCli(['translate', file])
    expect(res.code).toBe(1)
    expect(await readFile(file)).toEqual(before)
  })
})

describe('startup with a corrupt config file', () => {
  it('keeps --help working and reports the error only for commands that need config', async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), '{ broken')
    const help = await runCli(['--help'])
    expect(help.code).toBe(0)
    expect(help.stderr).toBe('')
    const get = await runCli(['config', 'get'])
    expect(get.code).toBe(1)
    expect(get.stderr).toMatch(/Invalid JSON in config file/)
  })
})

describe('tm import', () => {
  it('imports a TMX file and prints counts', async () => {
    const res = await runCli(['tm', 'import', sampleTmx, '--locale', 'tr'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/1 file/)
    expect(res.stdout).toMatch(/5 entries/)
    expect(res.stdout).toMatch(/5 upserted/)
  })

  it('accepts a glob and a non-canonical locale', async () => {
    const res = await runCli(['tm', 'import', join(sampleTmx, '..', '*.tmx'), '--locale', 'TR'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/5 entries/)
  })

  it('exits 1 on a broken file', async () => {
    // Genuinely broken, rather than a .po under a .tmx name: the importer picks
    // its parser by what the file holds, so that one imports now.
    const broken = join(home, 'broken.tmx')
    await writeFile(broken, 'not a catalogue of any kind', 'utf8')
    const res = await runCli(['tm', 'import', broken, '--locale', 'tr'])
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/broken\.tmx/)
  })

  it('imports a .po export, which is what translate.wordpress.org gives you', async () => {
    const res = await runCli(['tm', 'import', samplePo, '--locale', 'tr'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/entries/)
  })
})
