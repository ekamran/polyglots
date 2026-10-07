import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchHtml, USER_AGENT } from '../../src/wporg/http.js'
import { VERSION } from '../../src/version.js'

describe('fetchHtml', () => {
  let server: Server
  let base: string
  const seen: IncomingMessage[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req)
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body>merhaba</body></html>')
        return
      }
      if (req.url === '/missing') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('nope')
        return
      }
      res.writeHead(500)
      res.end('boom')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('returns the response body on 2xx', async () => {
    const html = await fetchHtml(`${base}/ok`)
    expect(html).toBe('<html><body>merhaba</body></html>')
  })

  it('sends the descriptive polyglots User-Agent', async () => {
    seen.length = 0
    await fetchHtml(`${base}/ok`)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe('GET')
    expect(seen[0]!.headers['user-agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toBe(`polyglots/${VERSION} (+https://github.com/emre/polyglots)`)
  })

  it('throws on 404 with the status in the message', async () => {
    await expect(fetchHtml(`${base}/missing`)).rejects.toThrow(/404/)
  })

  it('throws on 500', async () => {
    await expect(fetchHtml(`${base}/error`)).rejects.toThrow(/500/)
  })
})
