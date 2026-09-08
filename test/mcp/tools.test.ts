import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { openDb, replaceGlossary, upsertTm, getConsistency } from '../../src/storage/index.js'
import { registerTools } from '../../src/mcp/tools.js'
import type { ConsistencyEntry } from '../../src/types.js'

interface TextResult {
  isError?: boolean
  content: { type: string; text?: string }[]
}

function textOf(result: unknown): string {
  const r = result as TextResult
  const first = r.content[0]
  expect(first?.type).toBe('text')
  return first!.text!
}

describe('mcp tools', () => {
  let home: string
  let db: Database.Database
  let client: Client
  let server: McpServer
  let fetchConsistency: ReturnType<typeof vi.fn<(text: string, locale: string) => Promise<ConsistencyEntry[]>>>

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-mcp-tools-'))
    db = openDb(join(home, 'polyglots.db'))
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'Settings', translation: 'Ayarlar', partOfSpeech: 'noun' },
      { locale: 'tr', sourceTerm: 'Plugin', translation: 'Eklenti' },
    ])
    replaceGlossary(db, 'de', [{ locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' }])
    upsertTm(db, [
      { source: 'Save changes', target: 'Değişiklikleri kaydet', locale: 'tr' },
      { source: 'Save draft', target: 'Taslağı kaydet', locale: 'tr' },
      { source: 'Save changes', target: 'Änderungen speichern', locale: 'de' },
    ])
    fetchConsistency = vi.fn()
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerTools(server, { db, locale: 'tr', ttlDays: 30, fetchConsistency })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  it('lists exactly the three contract tools with descriptions', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['consistency_lookup', 'glossary_lookup', 'tm_lookup'])
    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('')
    }
  })

  it('glossary_lookup returns GlossaryEntry[] JSON for the default locale', async () => {
    const result = await client.callTool({ name: 'glossary_lookup', arguments: { term: 'settings' } })
    expect((result as TextResult).isError).not.toBe(true)
    expect(JSON.parse(textOf(result))).toEqual([
      { locale: 'tr', sourceTerm: 'Settings', translation: 'Ayarlar', partOfSpeech: 'noun' },
    ])
  })

  it('glossary_lookup honors an explicit locale', async () => {
    const result = await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings', locale: 'de' } })
    expect(JSON.parse(textOf(result))).toEqual([{ locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' }])
  })

  it('tm_lookup returns scored TmMatch[] and respects limit', async () => {
    const all = JSON.parse(textOf(await client.callTool({ name: 'tm_lookup', arguments: { text: 'Save changes' } })))
    expect(all[0]).toMatchObject({ source: 'Save changes', target: 'Değişiklikleri kaydet', locale: 'tr', score: 1 })
    expect(all).toHaveLength(2)
    const limited = JSON.parse(
      textOf(await client.callTool({ name: 'tm_lookup', arguments: { text: 'Save changes', limit: 1 } })),
    )
    expect(limited).toHaveLength(1)
    const de = JSON.parse(
      textOf(await client.callTool({ name: 'tm_lookup', arguments: { text: 'Save changes', locale: 'de' } })),
    )
    expect(de).toEqual([{ source: 'Save changes', target: 'Änderungen speichern', locale: 'de', score: 1 }])
  })

  it('consistency_lookup fetches on a miss and caches non-empty results', async () => {
    const entries: ConsistencyEntry[] = [{ translation: 'Ayarlar', count: 5, projects: ['wp/dev'] }]
    fetchConsistency.mockResolvedValueOnce(entries)

    const first = await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Settings' } })
    expect(JSON.parse(textOf(first))).toEqual(entries)
    expect(fetchConsistency).toHaveBeenCalledTimes(1)
    expect(fetchConsistency).toHaveBeenCalledWith('Settings', 'tr')
    expect(getConsistency(db, 'Settings', 'tr', 30)).toEqual(entries)

    const second = await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Settings' } })
    expect(JSON.parse(textOf(second))).toEqual(entries)
    expect(fetchConsistency).toHaveBeenCalledTimes(1)
  })

  it('consistency_lookup never caches an empty result', async () => {
    fetchConsistency.mockResolvedValue([])
    const first = await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Nothing' } })
    expect(JSON.parse(textOf(first))).toEqual([])
    expect(getConsistency(db, 'Nothing', 'tr', 30)).toBeUndefined()
    await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Nothing' } })
    expect(fetchConsistency).toHaveBeenCalledTimes(2)
  })

  it('consistency_lookup returns isError on fetch failure and caches nothing', async () => {
    fetchConsistency.mockRejectedValueOnce(new Error('HTTP 503 from translate.wordpress.org'))
    const result = (await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Boom' } })) as TextResult
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('HTTP 503')
    expect(getConsistency(db, 'Boom', 'tr', 30)).toBeUndefined()
  })

  it('exposes JSON input schemas with the contract properties and required fields', async () => {
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema as Record<string, unknown>]))
    expect(Object.keys(byName.glossary_lookup!.properties as object).sort()).toEqual(['locale', 'term'])
    expect(byName.glossary_lookup!.required).toEqual(['term'])
    expect(Object.keys(byName.consistency_lookup!.properties as object).sort()).toEqual(['locale', 'text'])
    expect(byName.consistency_lookup!.required).toEqual(['text'])
    expect(Object.keys(byName.tm_lookup!.properties as object).sort()).toEqual(['limit', 'locale', 'text'])
    expect(byName.tm_lookup!.required).toEqual(['text'])
    const limit = (byName.tm_lookup!.properties as Record<string, Record<string, unknown>>).limit!
    expect(limit.type).toBe('integer')
    expect(limit.maximum).toBe(50)
  })

  it('normalizes the locale argument (case and underscore) before storage and fetch', async () => {
    const glossary = await client.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings', locale: 'TR' } })
    expect(JSON.parse(textOf(glossary))).toHaveLength(1)
    const tm = await client.callTool({ name: 'tm_lookup', arguments: { text: 'Save changes', locale: 'De' } })
    expect(JSON.parse(textOf(tm))).toHaveLength(1)

    fetchConsistency.mockResolvedValueOnce([{ translation: 'x', count: 1, projects: [] }])
    await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Settings', locale: 'TR_tr' } })
    expect(fetchConsistency).toHaveBeenCalledWith('Settings', 'tr-tr')
    expect(getConsistency(db, 'Settings', 'tr-tr', 30)).toHaveLength(1)
  })

  it('consistency_lookup serializes concurrent fetches and dedupes identical in-flight texts', async () => {
    let inflight = 0
    let maxInflight = 0
    const order: string[] = []
    fetchConsistency.mockImplementation(async (text: string) => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      order.push(text)
      await new Promise((r) => setTimeout(r, 20))
      inflight -= 1
      return [{ translation: `${text}-tr`, count: 1, projects: [] }]
    })

    const results = await Promise.all(
      ['a', 'b', 'c', 'a'].map((text) => client.callTool({ name: 'consistency_lookup', arguments: { text } })),
    )
    expect(maxInflight).toBe(1)
    expect(fetchConsistency).toHaveBeenCalledTimes(3)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(results.map((r) => JSON.parse(textOf(r))[0].translation)).toEqual(['a-tr', 'b-tr', 'c-tr', 'a-tr'])
    expect(getConsistency(db, 'a', 'tr', 30)).toHaveLength(1)
  })

  it('consistency_lookup keeps serving after a queued fetch rejects', async () => {
    fetchConsistency.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([{ translation: 'ok', count: 1, projects: [] }])
    const [bad, good] = await Promise.all([
      client.callTool({ name: 'consistency_lookup', arguments: { text: 'bad' } }),
      client.callTool({ name: 'consistency_lookup', arguments: { text: 'good' } }),
    ])
    expect((bad as TextResult).isError).toBe(true)
    expect(JSON.parse(textOf(good))[0].translation).toBe('ok')
  })

  it('normalizes the default locale from deps once, so config values like TR_tr hit the same rows as tr-tr', async () => {
    const raw = new McpServer({ name: 'raw', version: '0.0.0' })
    const rawFetch = vi.fn<(text: string, locale: string) => Promise<ConsistencyEntry[]>>().mockResolvedValue([
      { translation: 'x', count: 1, projects: [] },
    ])
    registerTools(raw, { db, locale: 'De', ttlDays: 30, fetchConsistency: rawFetch })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await raw.connect(st)
    const rawClient = new Client({ name: 'raw-client', version: '0.0.0' })
    await rawClient.connect(ct)
    try {
      const glossary = await rawClient.callTool({ name: 'glossary_lookup', arguments: { term: 'Settings' } })
      expect(JSON.parse(textOf(glossary))).toEqual([{ locale: 'de', sourceTerm: 'Settings', translation: 'Einstellungen' }])
      const tm = await rawClient.callTool({ name: 'tm_lookup', arguments: { text: 'Save changes' } })
      expect(JSON.parse(textOf(tm))).toEqual([{ source: 'Save changes', target: 'Änderungen speichern', locale: 'de', score: 1 }])
      await rawClient.callTool({ name: 'consistency_lookup', arguments: { text: 'Settings' } })
      expect(rawFetch).toHaveBeenCalledWith('Settings', 'de')
      expect(getConsistency(db, 'Settings', 'de', 30)).toHaveLength(1)
    } finally {
      await rawClient.close()
      await raw.close()
    }
  })

  it('consistency_lookup passes an explicit locale to the fetcher and cache', async () => {
    const entries: ConsistencyEntry[] = [{ translation: 'Einstellungen', count: 2, projects: [] }]
    fetchConsistency.mockResolvedValueOnce(entries)
    await client.callTool({ name: 'consistency_lookup', arguments: { text: 'Settings', locale: 'de' } })
    expect(fetchConsistency).toHaveBeenCalledWith('Settings', 'de')
    expect(getConsistency(db, 'Settings', 'de', 30)).toEqual(entries)
    expect(getConsistency(db, 'Settings', 'tr', 30)).toBeUndefined()
  })
})
