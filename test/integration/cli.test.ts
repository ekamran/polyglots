import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { translateFile } from '../../src/commands/translate.js'
import { writeMcpConfig } from '../../src/mcp/config.js'
import { findExactTm, openDb } from '../../src/storage/index.js'
import { cliEntry, collect, entryOf, fakeClaude, fakeEngine, makeWorkspace, ofType, parseFile, snapshotEnv, tsxCli, writeTmx, type Workspace } from './helpers.js'

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

let ws: Workspace
let restoreEnv: () => void

function runCli(args: string[], opts: { stdin?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, POLYGLOTS_HOME: ws.home }
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

beforeAll(async () => {
  await chmod(fakeClaude, 0o755)
})

beforeEach(async () => {
  restoreEnv = snapshotEnv()
  ws = await makeWorkspace()
})

afterEach(async () => {
  restoreEnv()
  await ws.cleanup()
})

describe('F. CLI writes feed the in-process pipeline through POLYGLOTS_HOME', () => {
  it('tm import via the CLI lands in the DB the translate fast path reads', async () => {
    const tmxPath = await writeTmx(ws.home, 'poedit.tmx', [{ source: 'Save Changes', target: 'Değişiklikleri Kaydet' }])

    const res = await runCli(['tm', 'import', tmxPath, '--locale', 'tr'])
    expect(res.code, res.stderr).toBe(0)
    expect(res.stdout).toMatch(/1 entr/)

    const db = openDb(join(ws.home, 'data', 'polyglots.db'))
    try {
      expect(findExactTm(db, 'Save Changes', 'tr')).toEqual({
        source: 'Save Changes',
        target: 'Değişiklikleri Kaydet',
        locale: 'tr',
      })
    } finally {
      db.close()
    }

    const { events, onProgress } = collect()
    const engine = fakeEngine()
    const summary = await translateFile({
      file: ws.file,
      locale: 'tr',
      mode: 'pending',
      draftEngine: 'deepl',
      engine,
      claudeBin: fakeClaude,
      mcpConfigPath: await writeMcpConfig(),
      batchSize: 4,
      onProgress,
    })
    expect(summary).toMatchObject({ fromTm: 1, translated: 6 })
    expect(ofType(events, 'tm-hit')).toEqual([{ type: 'tm-hit', count: 1 }])
    expect(engine.seenKeys()).not.toContain('Save Changes')
    expect(entryOf(await parseFile(ws.file), 'Save Changes').msgstr).toEqual(['Değişiklikleri Kaydet'])
  })

  it('config set batchSize via the CLI becomes the default batch size of translateFile', async () => {
    const set = await runCli(['config', 'set', 'batchSize', '3'])
    expect(set.code, set.stderr).toBe(0)
    const get = await runCli(['config', 'get', 'batchSize'])
    expect(get.code, get.stderr).toBe(0)
    expect(get.stdout.trim()).toBe('3')
    expect(JSON.parse(await readFile(join(ws.home, 'config', 'config.json'), 'utf8'))).toMatchObject({ batchSize: 3 })

    const { events, onProgress } = collect()
    const summary = await translateFile({
      file: ws.file,
      locale: 'tr',
      mode: 'pending',
      draftEngine: 'deepl',
      engine: fakeEngine(),
      claudeBin: fakeClaude,
      mcpConfigPath: await writeMcpConfig(),
      onProgress,
    })
    expect(summary).toMatchObject({ pending: 7, translated: 7 })
    expect(ofType(events, 'batch-start').map((e) => [e.index, e.of, e.size])).toEqual([
      [1, 3, 3],
      [2, 3, 3],
      [3, 3, 1],
    ])
  })

  it('config set-key reads the secret from stdin, stores it in .env and only ever prints it masked', async () => {
    const key = 'dpl-INTEGRATION-0123456789:fx'
    const set = await runCli(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: `${key}\n` })
    expect(set.code, set.stderr).toBe(0)
    expect(set.stdout + set.stderr).not.toContain(key)

    const env = await readFile(join(ws.home, 'config', '.env'), 'utf8')
    expect(env).toContain(`DEEPL_API_KEY=${key}`)

    const get = await runCli(['config', 'get', 'DEEPL_API_KEY'])
    expect(get.code, get.stderr).toBe(0)
    expect(get.stdout.trim()).toBe('dpl-…fx')

    const all = await runCli(['config', 'get'])
    expect(all.code, all.stderr).toBe(0)
    expect(all.stdout).toContain('dpl-…fx')
    expect(all.stdout + all.stderr).not.toContain(key)
  })
})
