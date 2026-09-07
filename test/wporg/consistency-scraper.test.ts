import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildConsistencyUrl,
  fetchConsistency,
  parseConsistencyHtml,
} from '../../src/wporg/consistency-scraper.js'

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wporg', name), 'utf8')

describe('buildConsistencyUrl', () => {
  it('maps a bare locale to the default set and encodes the search text', () => {
    expect(buildConsistencyUrl('Settings', 'tr')).toBe(
      'https://translate.wordpress.org/consistency/?search=Settings&set=tr%2Fdefault&project=',
    )
  })

  it('encodes spaces, ampersands and unicode', () => {
    const url = new URL(buildConsistencyUrl('Save & Publish çık', 'tr'))
    expect(url.searchParams.get('search')).toBe('Save & Publish çık')
    expect(url.searchParams.get('set')).toBe('tr/default')
    expect(url.search).not.toContain(' ')
    expect(url.search).toContain('%26')
    expect(url.search).toContain('%C3%A7')
  })

  it('keeps an explicit locale/set pair as is', () => {
    expect(new URL(buildConsistencyUrl('x', 'de/formal')).searchParams.get('set')).toBe('de/formal')
  })
})

describe('parseConsistencyHtml', () => {
  it('groups real results by translation, sorted by count desc', () => {
    const entries = parseConsistencyHtml(fixture('consistency-settings-tr.html'))

    expect(entries.length).toBe(4)
    expect(entries.reduce((sum, e) => sum + e.count, 0)).toBe(500)
    expect(entries.map((e) => e.translation)).toEqual(['Ayarlar', 'Ayarları', 'ayarlar', 'Kurgu'])
    expect(entries.map((e) => e.count)).toEqual([494, 3, 2, 1])

    const top = entries[0]!
    expect(top.projects.length).toBe(494)
    expect(top.projects).toContain(
      'Plugins - 001 Prime Strategy Translate Accelerator - Development (trunk)',
    )
    expect(top.projects).toContain(
      'Plugins - 404 to 301 – Redirect Manager, 301 Redirection, 404 Error Logs & 404 Monitoring - Development (trunk)',
    )
    for (const e of entries) {
      expect(e.projects.length).toBe(e.count)
      expect(e.projects.every((p) => p.length > 0)).toBe(true)
    }
  })

  it('returns [] for a no-results page', () => {
    expect(parseConsistencyHtml(fixture('consistency-empty-tr.html'))).toEqual([])
  })

  it('returns [] for garbage input', () => {
    expect(parseConsistencyHtml('')).toEqual([])
    expect(parseConsistencyHtml('<html><body><p>nope</p></body></html>')).toEqual([])
    expect(parseConsistencyHtml('not html at all {{{')).toEqual([])
  })

  it('decodes entities and ignores rows without a translation string', () => {
    const html = `
      <table class="gp-table consistency-table"><tbody>
        <tr class="new-translation"><th colspan="2"><strong>A &amp; B</strong></th></tr>
        <tr class="project-plugins">
          <td><div class="string">Foo</div><div class="meta">Project: <a href="/p/x/">Plugins - X</a></div></td>
          <td><div class="string">A &amp; B</div></td>
        </tr>
        <tr class="project-themes">
          <td><div class="string">Foo</div><div class="meta">Project: <a href="/p/y/">Themes - Y</a></div></td>
          <td><div class="string">  A &amp; B </div></td>
        </tr>
        <tr class="project-plugins">
          <td><div class="string">Foo</div><div class="meta">Project: <a href="/p/z/">Plugins - Z</a></div></td>
          <td><div class="meta">no string here</div></td>
        </tr>
      </tbody></table>`
    expect(parseConsistencyHtml(html)).toEqual([
      { translation: 'A & B', count: 2, projects: ['Plugins - X', 'Themes - Y'] },
    ])
  })
})

describe('fetchConsistency', () => {
  it('fetches the built URL and parses the response', async () => {
    const calls: string[] = []
    const fake = async (url: string) => {
      calls.push(url)
      return fixture('consistency-settings-tr.html')
    }
    const entries = await fetchConsistency('Settings', 'tr', fake)
    expect(calls).toEqual([buildConsistencyUrl('Settings', 'tr')])
    expect(entries[0]).toMatchObject({ translation: 'Ayarlar', count: 494 })
  })

  it('propagates fetch errors', async () => {
    const failing = async () => {
      throw new Error('boom')
    }
    await expect(fetchConsistency('Settings', 'tr', failing)).rejects.toThrow('boom')
  })
})
