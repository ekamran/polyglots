import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { openDb, replaceGlossary } from '../../src/storage/index.js'
import { writeMcpConfig } from '../../src/mcp/config.js'

interface McpJson {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !pidAlive(pid)
}

interface Spawned {
  child: ChildProcess
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  stderr: () => string
}

async function spawnInitialized(configPath: string): Promise<Spawned> {
  const { mcpServers } = JSON.parse(await readFile(configPath, 'utf8')) as McpJson
  const entry = mcpServers.polyglots!
  const child = spawn(entry.command, entry.args, {
    env: { ...process.env, ...entry.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  const firstLine = new Promise<string>((resolve) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl >= 0) {
        child.stdout!.off('data', onData)
        resolve(buf.slice(0, nl))
      }
    }
    child.stdout!.on('data', onData)
  })
  child.stdin!.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    }) + '\n',
  )
  const reply = JSON.parse(await firstLine) as { id: number; result?: unknown }
  expect(reply.id).toBe(1)
  expect(reply.result).toBeDefined()
  return { child, exit, stderr: () => stderr }
}

describe('mcp server shutdown (raw stdio child)', () => {
  let home: string
  const original = process.env.POLYGLOTS_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-mcp-shutdown-'))
    process.env.POLYGLOTS_HOME = home
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = original
    await rm(home, { recursive: true, force: true })
  })

  // The SDK client's close() falls back to SIGTERM after 2s, which would mask a missing EOF handler;
  // here nothing but stdin EOF is sent, and exit must land well inside that window.
  it('exits 0 promptly on stdin EOF without any signal', async () => {
    const { child, exit, stderr } = await spawnInitialized(await writeMcpConfig())
    const started = Date.now()
    child.stdin!.end()
    const outcome = await Promise.race([
      exit,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 1500)),
    ])
    if (outcome === 'timeout') child.kill('SIGKILL')
    expect(outcome, `stderr: ${stderr()}`).toEqual({ code: 0, signal: null })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('exits 130 on SIGINT so a parent can tell an interrupt from a normal shutdown', async () => {
    const { child, exit, stderr } = await spawnInitialized(await writeMcpConfig())
    child.kill('SIGINT')
    const outcome = await Promise.race([
      exit,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000)),
    ])
    if (outcome === 'timeout') child.kill('SIGKILL')
    expect(outcome, `stderr: ${stderr()}`).toEqual({ code: 130, signal: null })
  })
})

describe('mcp server (stdio, end-to-end)', () => {
  let home: string
  const original = process.env.POLYGLOTS_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-mcp-server-'))
    process.env.POLYGLOTS_HOME = home
    const db = openDb()
    replaceGlossary(db, 'tr', [{ locale: 'tr', sourceTerm: 'Settings', translation: 'Ayarlar' }])
    db.close()
  })

  afterEach(async () => {
    if (original === undefined) delete process.env.POLYGLOTS_HOME
    else process.env.POLYGLOTS_HOME = original
    await rm(home, { recursive: true, force: true })
  })

  it('serves tools over stdio from the generated mcp.json and exits when the client disconnects', async () => {
    const configPath = await writeMcpConfig()
    const { mcpServers } = JSON.parse(await readFile(configPath, 'utf8')) as McpJson
    const entry = mcpServers.polyglots!

    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...process.env as Record<string, string>, ...entry.env },
      stderr: 'pipe',
    })
    let stderr = ''
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

    const client = new Client({ name: 'e2e', version: '0.0.0' })
    await client.connect(transport)
    const pid = transport.pid
    expect(pid).not.toBeNull()

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['consistency_lookup', 'glossary_lookup', 'tm_lookup'])

    const result = (await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings' } })) as {
      content: { type: string; text?: string }[]
    }
    expect(JSON.parse(result.content[0]!.text!)).toEqual([
      { locale: 'tr', sourceTerm: 'Settings', translation: 'Ayarlar' },
    ])

    await client.close()
    const exited = await waitForExit(pid!, 3000)
    if (!exited) process.kill(pid!, 'SIGKILL')
    expect(exited, `server did not exit after transport close; stderr: ${stderr}`).toBe(true)
  })

  it('honors POLYGLOTS_LOCALE so tool defaults follow the run locale, not the config default', async () => {
    const db = openDb()
    replaceGlossary(db, 'de', [{ locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' }])
    db.close()

    const configPath = await writeMcpConfig({ env: { POLYGLOTS_LOCALE: 'de' } })
    const { mcpServers } = JSON.parse(await readFile(configPath, 'utf8')) as McpJson
    const entry = mcpServers.polyglots!
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...process.env as Record<string, string>, ...entry.env },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'e2e', version: '0.0.0' })
    await client.connect(transport)
    const pid = transport.pid!

    const result = (await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings' } })) as {
      content: { type: string; text?: string }[]
    }
    expect(JSON.parse(result.content[0]!.text!)).toEqual([
      { locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' },
    ])

    await client.close()
    const exited = await waitForExit(pid, 3000)
    if (!exited) process.kill(pid, 'SIGKILL')
    expect(exited).toBe(true)
  })

  it('honors POLYGLOTS_DB and exits cleanly on SIGTERM', async () => {
    const altDb = join(home, 'alt', 'other.db')
    const db = openDb(altDb)
    replaceGlossary(db, 'tr', [{ locale: 'tr', sourceTerm: 'Plugin', translation: 'Eklenti' }])
    db.close()

    const configPath = await writeMcpConfig({ env: { POLYGLOTS_DB: altDb } })
    const { mcpServers } = JSON.parse(await readFile(configPath, 'utf8')) as McpJson
    const entry = mcpServers.polyglots!
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...process.env as Record<string, string>, ...entry.env },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'e2e', version: '0.0.0' })
    await client.connect(transport)
    const pid = transport.pid!

    const result = (await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Plugin' } })) as {
      content: { type: string; text?: string }[]
    }
    expect(JSON.parse(result.content[0]!.text!)).toEqual([{ locale: 'tr', sourceTerm: 'Plugin', translation: 'Eklenti' }])
    const missing = (await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings' } })) as {
      content: { type: string; text?: string }[]
    }
    expect(JSON.parse(missing.content[0]!.text!)).toEqual([])

    process.kill(pid, 'SIGTERM')
    const exited = await waitForExit(pid, 3000)
    if (!exited) process.kill(pid, 'SIGKILL')
    expect(exited).toBe(true)
    await client.close().catch(() => {})
  })
})
