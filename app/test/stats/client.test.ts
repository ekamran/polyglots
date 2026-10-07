// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoPayloads } from '../../src/stats/demo.js'
import { ENGLISH } from '../../src/stats/i18n.js'
import { boot, compareValues, matchesFilter, type BootData, type Client } from '../../src/stats/page/client.js'
import { renderRoot } from '../../src/stats/page/views.js'
import { STATS_TRANSLATIONS } from '../../src/stats/translations-data.js'

const demo = demoPayloads()
const languages = [ENGLISH, ...STATS_TRANSLATIONS]

function mount(data: BootData): void {
  const payload = data.payloads[data.range]!
  const lang = languages.find((l) => l.tag === data.lang)!
  document.body.innerHTML =
    `<div id="root">${renderRoot({ payload, lang, languages })}</div>` +
    `<div id="tip" role="tooltip" hidden></div>` +
    `<script type="application/json" id="stats-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

let client: Client | undefined

beforeEach(() => {
  history.replaceState(null, '', '/tok/')
  document.documentElement.className = ''
})

afterEach(() => {
  client?.stop()
  client = undefined
  vi.restoreAllMocks()
})

const click = (el: Element | null) => (el as HTMLElement).click()
const view = (id: string) => document.getElementById(id)!

describe('compareValues', () => {
  it('sorts figures as numbers, not as text', () => {
    expect(['9', '10', '100'].sort((a, b) => compareValues(a, b, true, 'en'))).toEqual(['9', '10', '100'])
  })

  it('sorts names the way the language alphabetises them', () => {
    expect(['Zebra', 'Çiçek', 'Ayna'].sort((a, b) => compareValues(a, b, false, 'tr'))).toEqual(['Ayna', 'Çiçek', 'Zebra'])
  })
})

describe('matchesFilter', () => {
  it('matches part of a name, ignoring case the way the language does', () => {
    expect(matchesFilter('İçerik Yöneticisi', 'içerik', 'tr')).toBe(true)
    expect(matchesFilter('Lumen Forms', 'harbor', 'en')).toBe(false)
    expect(matchesFilter('Anything', '  ', 'en')).toBe(true)
  })
})

describe('boot', () => {
  it('marks the page as scripted and shows one view at a time, the overview first', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    expect(document.documentElement.classList.contains('js')).toBe(true)
    expect(view('overview').classList.contains('active')).toBe(true)
    expect(view('reviews').classList.contains('active')).toBe(false)
    expect(document.querySelector('[data-view="overview"]')!.getAttribute('aria-current')).toBe('page')
  })

  it('follows the hash to another view', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    location.hash = '#reviews'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(view('reviews').classList.contains('active')).toBe(true)
    expect(view('overview').classList.contains('active')).toBe(false)
  })

  it('sorts a table numerically when its header is pressed, and says so with aria-sort', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    const table = document.querySelector('#projects table.proj-top')!
    const runs = table.querySelectorAll('th')[1]!
    click(runs.querySelector('button'))
    expect(runs.getAttribute('aria-sort')).toBe('descending')
    const values = [...table.querySelectorAll('tbody tr')].map((tr) => Number(tr.children[1]!.getAttribute('data-v')))
    expect(values).toEqual([...values].sort((a, b) => b - a))
    click(runs.querySelector('button'))
    expect(runs.getAttribute('aria-sort')).toBe('ascending')
  })

  it('filters the full projects table as the reader types', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    const input = document.querySelector<HTMLInputElement>('#projects [data-filter]')!
    input.value = 'harbor'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const shown = [...document.querySelectorAll('#projects table.proj-all tbody tr')].filter((tr) => !(tr as HTMLElement).hidden)
    expect(shown.map((tr) => tr.children[0]!.textContent)).toEqual(['Harbor Booking'])
  })

  it('swaps ranges from the embedded data in the standalone copy, without fetching', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    const fetch = vi.fn()
    client = boot(document, window, { fetch })
    click(document.querySelector('[data-range="30d"]'))
    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-range="30d"]')!.getAttribute('aria-current')).toBe('true')
    expect(location.search).toBe('?range=30d')
  })

  it('asks the server for a range it does not have yet', async () => {
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
    const fetch = vi.fn(async () => new Response(JSON.stringify(demo['90d']), { status: 200 }))
    client = boot(document, window, { fetch })
    click(document.querySelector('[data-range="90d"]'))
    await client.idle()
    expect(fetch).toHaveBeenCalledWith('api/stats?range=90d', expect.anything())
    expect(document.querySelector('[data-range="90d"]')!.getAttribute('aria-current')).toBe('true')
  })

  it('says the job store is busy and keeps the last numbers when the server answers 503', async () => {
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
    const fetch = vi.fn(async () => new Response('{"error":"busy"}', { status: 503 }))
    client = boot(document, window, { fetch })
    click(document.querySelector('[data-range="30d"]'))
    await client.idle()
    expect((document.querySelector('.busy') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('[data-range="all"]')!.getAttribute('aria-current')).toBe('true')
  })

  it('switches language, redraws, and sets the lang attribute for correct casing', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    click(document.querySelector('[data-lang="tr"]'))
    expect(document.documentElement.lang).toBe('tr')
    expect(document.body.textContent).toContain('Genel bakış')
    expect(location.search).toBe('?range=all&lang=tr')
  })

  it('keeps the reader on the same view across a redraw', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    location.hash = '#projects'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    click(document.querySelector('[data-range="90d"]'))
    expect(view('projects').classList.contains('active')).toBe(true)
  })

  it('shows a tooltip on focus and hides it on Escape', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    const row = document.querySelector<HTMLElement>('.legend li[data-tip-title]')!
    row.focus()
    row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    const tip = document.getElementById('tip')!
    expect(tip.hidden).toBe(false)
    expect(tip.textContent).toContain(row.getAttribute('data-tip-title')!)
    expect(row.getAttribute('aria-describedby')).toBe('tip')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(tip.hidden).toBe(true)
  })

  it('remembers the theme the reader picked', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    click(document.querySelector('[data-theme-set="dark"]'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('polyglots-stats-theme')).toBe('dark')
    expect(document.querySelector('[data-theme-set="dark"]')!.getAttribute('aria-pressed')).toBe('true')
  })
})
