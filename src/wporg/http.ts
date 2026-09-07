export const USER_AGENT = 'polyglots/0.1 (+https://github.com/emre/polyglots)'
const TIMEOUT_MS = 20_000

export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
    }
    return await res.text()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`GET ${url} timed out after ${TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
