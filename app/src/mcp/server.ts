#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config.js'
import { openDb } from '../storage/index.js'
import { resolveServerOptions } from './config.js'
import { registerTools } from './tools.js'

const CLOSE_TIMEOUT_MS = 2000

async function main(): Promise<void> {
  const { locale, ttlDays, dbPath } = resolveServerOptions(process.env, loadConfig())
  const db = openDb(dbPath)
  const server = new McpServer({ name: 'polyglots', version: '0.1.0' })
  registerTools(server, { db, locale, ttlDays })

  let closing = false
  const shutdown = async (code: number): Promise<void> => {
    if (closing) return
    closing = true
    const timer = setTimeout(() => {
      db.close()
      process.exit(code)
    }, CLOSE_TIMEOUT_MS)
    try {
      await server.close()
    } catch {
      // the transport is already gone; nothing left to flush
    } finally {
      clearTimeout(timer)
      db.close()
      process.exit(code)
    }
  }

  process.on('SIGTERM', () => void shutdown(0))
  process.on('SIGINT', () => void shutdown(130))
  process.stdin.on('end', () => void shutdown(0))
  process.stdin.on('close', () => void shutdown(0))

  const transport = new StdioServerTransport()
  transport.onclose = () => void shutdown(0)
  await server.connect(transport)
}

main().catch((error: unknown) => {
  process.stderr.write(`polyglots mcp server failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
