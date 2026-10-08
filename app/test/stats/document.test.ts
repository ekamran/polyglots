import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLIENT_JS } from '../../src/stats/client-bundle.js'
import { demoPayloads } from '../../src/stats/demo.js'
import { renderDocument } from '../../src/stats/document.js'
import { ENGLISH } from '../../src/stats/i18n.js'
import { STATS_TRANSLATIONS } from '../../src/stats/translations-data.js'

const demo = demoPayloads()
const TR = STATS_TRANSLATIONS.find((l) => l.tag === 'tr')!
const sha = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

function inner(html: string, open: RegExp, close: string): string {
  const m = open.exec(html)!
  const start = m.index + m[0].length
  return html.slice(start, html.indexOf(close, start))
}

describe('renderDocument', () => {
  it('is a whole page in the chosen language', () => {
    const { html } = renderDocument({ mode: 'server', range: 'all', payloads: { all: demo.all }, lang: TR })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="tr"')
    expect(html).toContain('<title>polyglots · İnceleme istatistikleri</title>')
  })

  it('inlines the client and pins it, and the style, with a content security policy', () => {
    const doc = renderDocument({ mode: 'static', range: 'all', payloads: demo, lang: ENGLISH })
    const script = inner(doc.html, /<script>/, '</script>')
    const style = inner(doc.html, /<style>/, '</style>')
    expect(script).toContain(CLIENT_JS.slice(0, 200))
    expect(doc.csp).toContain(`script-src ${sha(script)}`)
    expect(doc.csp).toContain(`style-src ${sha(style)}`)
    expect(doc.csp).toContain("default-src 'none'")
    expect(doc.html).toContain(`<meta http-equiv="Content-Security-Policy" content="${doc.csp}">`)
  })

  it('lets the server copy call home and nothing else, and the standalone copy call nowhere', () => {
    expect(renderDocument({ mode: 'server', range: 'all', payloads: { all: demo.all }, lang: ENGLISH }).csp).toContain(
      "connect-src 'self'",
    )
    expect(renderDocument({ mode: 'static', range: 'all', payloads: demo, lang: ENGLISH }).csp).not.toContain('connect-src')
  })

  it('loads nothing from outside: no CDN, no remote font, no external script or stylesheet', () => {
    const { html } = renderDocument({ mode: 'static', range: 'all', payloads: demo, lang: ENGLISH })
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
    // Two addresses appear and neither is fetched: the SVG namespace, and the
    // site's address, which the share card draws as text.
    expect(html).not.toMatch(/@import|@font-face|https?:\/\/(?!www\.w3\.org|ada\.tools\/polyglots\/)/)
  })

  it('embeds the data so no name can close the script element it sits in', () => {
    const p = structuredClone(demo.all)
    p.review.byProject = [{ project: '</script><script>alert(1)</script>', runs: 1, entries: 1, flagged: 0 }]
    const { html } = renderDocument({ mode: 'static', range: 'all', payloads: { all: p }, lang: ENGLISH })
    const data = inner(html, /<script type="application\/json" id="stats-data">/, '</script>')
    expect(data).not.toContain('<')
    expect(JSON.parse(data).payloads.all.review.byProject[0].project).toBe('</script><script>alert(1)</script>')
  })

  it('paints the first view on the server, so the page reads before the script runs', () => {
    const { html } = renderDocument({ mode: 'server', range: 'all', payloads: { all: demo.all }, lang: ENGLISH })
    expect(html).toContain('<div id="root">')
    expect(html).toContain('What gets flagged')
  })

  it('defines both themes and honours the system preference unless the reader picked one', () => {
    const { html } = renderDocument({ mode: 'static', range: 'all', payloads: demo, lang: ENGLISH })
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)/)
    expect(html).toContain(':root[data-theme="dark"]')
  })
})
