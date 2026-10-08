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
  delete document.documentElement.dataset.theme
  localStorage.clear()
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
    expect(location.search).toBe('')
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
    expect(location.search).toBe('')
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

  // The server stamps every payload with the time it was built, so a refresh
  // whose numbers had not moved still looked like news and rebuilt the page:
  // focus, a half-typed filter and scroll positions went with it.
  it('leaves the page alone when a refresh brings the same numbers at a later time', async () => {
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
    const later = { ...demo.all, generatedAt: demo.all.generatedAt + 30_000 }
    const fetch = vi.fn(async () => new Response(JSON.stringify(later), { status: 200 }))
    client = boot(document, window, { fetch })
    const header = document.querySelector('#root > header')
    document.dispatchEvent(new Event('visibilitychange'))
    await client.idle()
    expect(fetch).toHaveBeenCalled()
    expect(document.querySelector('#root > header')).toBe(header)
  })

  it('keeps the reader in the filter box, mid-word, when a refresh does redraw', async () => {
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
    const changed = structuredClone(demo.all)
    changed.review.entries += 1
    const fetch = vi.fn(async () => new Response(JSON.stringify(changed), { status: 200 }))
    client = boot(document, window, { fetch })
    document.querySelector<HTMLDetailsElement>('#projects details')!.open = true
    const input = document.querySelector<HTMLInputElement>('#projects [data-filter]')!
    input.focus()
    input.value = 'har'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.dispatchEvent(new Event('visibilitychange'))
    await client.idle()
    const now = document.activeElement as HTMLInputElement
    expect(now).not.toBe(input)
    expect(now.matches('#projects [data-filter]')).toBe(true)
    expect(now.value).toBe('har')
  })

  it('keeps focus on the sort button the reader pressed, in the right table, across a redraw', async () => {
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
    const changed = structuredClone(demo.all)
    changed.review.entries += 1
    const fetch = vi.fn(async () => new Response(JSON.stringify(changed), { status: 200 }))
    client = boot(document, window, { fetch })
    const button = document.querySelectorAll<HTMLButtonElement>('#projects table.proj-all [data-sort]')[2]!
    button.focus()
    document.dispatchEvent(new Event('visibilitychange'))
    await client.idle()
    const now = document.activeElement as HTMLElement
    expect(now).not.toBe(button)
    expect(now.closest('table')?.classList.contains('proj-all')).toBe(true)
    expect(now.getAttribute('data-sort')).toBe('2')
  })

  // Controls were found again by their position among every match on the
  // page, so a refresh that added a table earlier in the page (the translate
  // view passing ten projects and gaining its full list) moved focus, the
  // open list, the filter text and the sort onto a different table.
  it('keeps focus, the open list, the filter and the sort on their own table when a refresh adds another', async () => {
    const before = structuredClone(demo.all)
    before.translate.byProject = before.translate.byProject.slice(0, 10)
    mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: before } })
    const fetch = vi.fn(async () => new Response(JSON.stringify(demo.all), { status: 200 }))
    client = boot(document, window, { fetch })
    expect(document.querySelector('#translation table.proj-all')).toBeNull()
    document.querySelector<HTMLDetailsElement>('#projects details')!.open = true
    const input = document.querySelector<HTMLInputElement>('#projects [data-filter]')!
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const button = document.querySelectorAll<HTMLButtonElement>('#projects table.proj-all [data-sort]')[2]!
    click(button)
    button.focus()
    document.dispatchEvent(new Event('visibilitychange'))
    await client.idle()
    expect(document.querySelector('#translation table.proj-all')).not.toBeNull()
    const now = document.activeElement as HTMLElement
    expect(now).not.toBe(button)
    expect(now.closest('table')?.classList.contains('proj-all')).toBe(true)
    expect(now.closest('.view')?.id).toBe('projects')
    expect(document.querySelector<HTMLDetailsElement>('#projects details')!.open).toBe(true)
    expect(document.querySelector<HTMLDetailsElement>('#translation details')!.open).toBe(false)
    expect(document.querySelector<HTMLInputElement>('#projects [data-filter]')!.value).toBe('a')
    expect(document.querySelector<HTMLInputElement>('#translation [data-filter]')!.value).toBe('')
    expect(document.querySelector('#projects table.proj-all th:nth-child(3)')!.getAttribute('aria-sort')).not.toBe('none')
    expect(document.querySelector('#translation table.proj-all th:nth-child(3)')!.getAttribute('aria-sort')).toBe('none')
  })

  it('remembers the theme the reader picked', () => {
    mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
    client = boot(document, window)
    click(document.querySelector('[data-theme-set="dark"]'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('polyglots-stats-theme')).toBe('dark')
    expect(document.querySelector('[data-theme-set="dark"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  // The reader's choices live in localStorage, not the address: the address
  // carries a new token every time the server starts, so a choice kept there
  // was gone the next time the page was opened.
  describe('choices kept across a reload', () => {
    it('stores the range, the language and the view as they are chosen', () => {
      mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
      client = boot(document, window)
      click(document.querySelector('[data-range="30d"]'))
      click(document.querySelector('[data-lang="tr"]'))
      location.hash = '#reviews'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      expect(localStorage.getItem('polyglots-stats-range')).toBe('30d')
      expect(localStorage.getItem('polyglots-stats-lang')).toBe('tr')
      expect(localStorage.getItem('polyglots-stats-view')).toBe('reviews')
    })

    it('opens with every stored choice, at an address that names none of them', () => {
      localStorage.setItem('polyglots-stats-range', '90d')
      localStorage.setItem('polyglots-stats-lang', 'tr')
      localStorage.setItem('polyglots-stats-view', 'projects')
      localStorage.setItem('polyglots-stats-theme', 'dark')
      mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
      client = boot(document, window)
      expect(document.querySelector('[data-range="90d"]')!.getAttribute('aria-current')).toBe('true')
      expect(document.documentElement.lang).toBe('tr')
      expect(view('projects').classList.contains('active')).toBe(true)
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('asks the server for a stored range the first paint did not include', async () => {
      localStorage.setItem('polyglots-stats-range', '30d')
      mount({ mode: 'server', range: 'all', lang: 'en', payloads: { all: demo.all } })
      const fetch = vi.fn(async () => new Response(JSON.stringify(demo['30d']), { status: 200 }))
      client = boot(document, window, { fetch })
      await client.idle()
      expect(fetch).toHaveBeenCalledWith('api/stats?range=30d', expect.anything())
      expect(document.querySelector('[data-range="30d"]')!.getAttribute('aria-current')).toBe('true')
    })

    it('ignores a stored value it does not recognise', () => {
      localStorage.setItem('polyglots-stats-range', 'forever')
      localStorage.setItem('polyglots-stats-lang', 'xx')
      localStorage.setItem('polyglots-stats-view', 'nowhere')
      mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
      client = boot(document, window)
      expect(document.querySelector('[data-range="all"]')!.getAttribute('aria-current')).toBe('true')
      expect(document.documentElement.lang).toBe('en')
      expect(view('overview').classList.contains('active')).toBe(true)
    })

    it('still works where storage throws, as in some private windows', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied')
      })
      mount({ mode: 'static', range: 'all', lang: 'en', payloads: demo })
      client = boot(document, window)
      click(document.querySelector('[data-range="30d"]'))
      expect(document.querySelector('[data-range="30d"]')!.getAttribute('aria-current')).toBe('true')
    })
  })
})
