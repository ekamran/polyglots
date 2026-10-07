// Typechecked by tsconfig.client.json, which adds the DOM library, and kept
// out of the main program by tsconfig.json: a lib reference here would have
// given every Node file in src the browser's globals, and tsc would have
// emitted this file into dist, where nothing loads it. The browser gets it
// through the esbuild bundle instead.

import { ENGLISH, languageByTag, type StatsLanguage } from '../i18n.js'
import { STATS_TRANSLATIONS } from '../translations-data.js'
import { parseRange, type BootData, type Range, type StatsPayload } from './model.js'
import { shareCard, SHARE_HEIGHT, SHARE_WIDTH } from './share-card.js'
import { renderRoot, VIEWS, type View } from './views.js'

// The page's behaviour in the browser: views, ranges, language, theme,
// sorting, filtering, tooltips, the share image and the refresh. Everything
// it draws goes through renderRoot, the same function the server used for the
// first paint, so a redraw never looks different from a fresh load.
//
// Events are delegated from the document, so a redraw that replaces the whole
// root needs no rebinding.

export type { BootData }

export interface Client {
  // Resolves once any fetch in flight has settled; for tests.
  idle(): Promise<void>
  stop(): void
}

interface Deps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

const THEME_KEY = 'polyglots-stats-theme'
const REFRESH_MS = 30_000
const LANGUAGES: readonly StatsLanguage[] = [ENGLISH, ...STATS_TRANSLATIONS]

/** Order two sort values: numerically for a figure, alphabetically in the page language for a name. */
export function compareValues(a: string, b: string, numeric: boolean, tag: string): number {
  if (numeric) return Number(a) - Number(b)
  return a.localeCompare(b, tag, { sensitivity: 'base' })
}

/** Whether a row's text matches what the reader typed. Lowercased in the page language, so İ finds i in Turkish. */
export function matchesFilter(text: string, query: string, tag: string): boolean {
  const q = query.trim().toLocaleLowerCase(tag)
  return q === '' || text.toLocaleLowerCase(tag).includes(q)
}

// Storage can throw outright in a private window or with site data blocked.
// The theme is a convenience, so a failure here means "auto", never an error.
function stored(win: Window): string | null {
  try {
    return win.localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

function store(win: Window, value: string): void {
  try {
    if (value === 'auto') win.localStorage.removeItem(THEME_KEY)
    else win.localStorage.setItem(THEME_KEY, value)
  } catch {
    // ignored: see stored()
  }
}

export function boot(doc: Document, win: Window, deps: Deps = {}): Client {
  const root = doc.getElementById('root')!
  const tip = doc.getElementById('tip')!
  const data = JSON.parse(doc.getElementById('stats-data')!.textContent ?? '{}') as BootData
  const fetcher = deps.fetch ?? ((url, init) => win.fetch(url, init))
  const params = new URLSearchParams(win.location.search)

  let range: Range = data.range
  let lang: StatsLanguage = languageByTag(data.lang, STATS_TRANSLATIONS) ?? ENGLISH
  const payloads = { ...data.payloads }
  let pending: Promise<void> = Promise.resolve()
  let retry = 2_000
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // Sort state survives a redraw (the refresh would otherwise undo a sort the
  // reader just made every thirty seconds), keyed by the table's place.
  const sorts = new Map<string, { col: number; dir: 'ascending' | 'descending' }>()

  doc.documentElement.classList.add('js')

  function applyTheme(): void {
    const theme = stored(win) ?? 'auto'
    if (theme === 'auto') delete doc.documentElement.dataset.theme
    else doc.documentElement.dataset.theme = theme
    for (const b of doc.querySelectorAll('[data-theme-set]')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === theme))
    }
  }

  function currentView(): View {
    const hash = win.location.hash.slice(1)
    return (VIEWS as readonly string[]).includes(hash) ? (hash as View) : 'overview'
  }

  function showView(): void {
    const active = currentView()
    for (const v of VIEWS) doc.getElementById(v)?.classList.toggle('active', v === active)
    for (const a of doc.querySelectorAll('[data-view]')) {
      if (a.getAttribute('data-view') === active) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    }
  }

  function tableKey(table: Element): string {
    const section = table.closest('.view')?.id ?? ''
    const all = [...(table.closest('.view') ?? doc).querySelectorAll('table.sortable')]
    return `${section}:${all.indexOf(table)}`
  }

  function applySort(table: HTMLTableElement, col: number, dir: 'ascending' | 'descending'): void {
    const head = table.querySelectorAll('th')
    const numeric = head[col]?.querySelector('[data-numeric]') !== null
    const body = table.querySelector('tbody')!
    const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>(':scope > tr'))
    const sign = dir === 'ascending' ? 1 : -1
    rows.sort((a, b) => {
      const va = a.cells[col]?.getAttribute('data-v') ?? ''
      const vb = b.cells[col]?.getAttribute('data-v') ?? ''
      return sign * compareValues(va, vb, numeric, lang.tag)
    })
    for (const row of rows) body.appendChild(row)
    head.forEach((th, i) => {
      th.setAttribute('aria-sort', i === col ? dir : 'none')
      const arrow = th.querySelector('.dir')
      if (arrow) arrow.textContent = i === col ? (dir === 'ascending' ? '↑' : '↓') : ''
    })
    sorts.set(tableKey(table), { col, dir })
  }

  function sortBy(button: Element): void {
    const table = button.closest('table') as HTMLTableElement
    const col = Number(button.getAttribute('data-sort'))
    const th = button.closest('th')!
    const now = th.getAttribute('aria-sort')
    // A figure's first press puts the biggest first, which is the question a
    // number column is usually asked; a name's first press is A to Z.
    const first = button.hasAttribute('data-numeric') ? 'descending' : 'ascending'
    const dir = now === 'none' || now === null ? first : now === 'ascending' ? 'descending' : 'ascending'
    applySort(table, col, dir)
  }

  function filter(input: HTMLInputElement): void {
    const table = input.closest('details')?.querySelector('table')
    if (!table) return
    for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody > tr')) {
      row.hidden = !matchesFilter(row.cells[0]?.textContent ?? '', input.value, lang.tag)
    }
  }

  function render(): void {
    const payload = payloads[range]
    if (!payload) return
    // A redraw replaces every element, so the state a reader built up by hand
    // (open details, filter text, focus) is read off first and put back.
    const open = [...root.querySelectorAll('details')].map((d) => d.open)
    const filters = [...root.querySelectorAll<HTMLInputElement>('[data-filter]')].map((i) => i.value)
    const focused = doc.activeElement && root.contains(doc.activeElement) ? focusKey(doc.activeElement) : undefined

    root.innerHTML = renderRoot({ payload, lang, languages: LANGUAGES })

    root.querySelectorAll('details').forEach((d, i) => (d.open = open[i] ?? false))
    root.querySelectorAll<HTMLInputElement>('[data-filter]').forEach((input, i) => {
      input.value = filters[i] ?? ''
      if (input.value !== '') filter(input)
    })
    for (const table of root.querySelectorAll<HTMLTableElement>('table.sortable')) {
      const s = sorts.get(tableKey(table))
      if (s) applySort(table, s.col, s.dir)
    }
    if (focused) root.querySelectorAll<HTMLElement>(focused.selector)[focused.index]?.focus()
    doc.documentElement.lang = lang.tag
    doc.title = `polyglots · ${root.querySelector('h1')?.textContent ?? ''}`
    applyTheme()
    showView()
  }

  // Where the focused control sits, as a selector and its position among the
  // matches, so the same control can be found after a redraw. The position
  // matters: every projects table has a [data-sort="2"], and both views with a
  // long project list have a [data-filter]. A redraw from the same kind of
  // payload produces the same structure, so the nth match is the same control.
  function focusKey(el: Element): { selector: string; index: number } | undefined {
    for (const attr of ['data-filter', 'data-sort', 'data-range', 'data-lang', 'data-theme-set', 'data-view', 'data-share']) {
      const v = el.getAttribute(attr)
      if (v === null) continue
      const selector = v === '' ? `[${attr}]` : `[${attr}="${v}"]`
      return { selector, index: [...root.querySelectorAll(selector)].indexOf(el) }
    }
    return undefined
  }

  // Equal apart from when the server built them. Every payload carries its
  // build time, so comparing them whole made every refresh look like news and
  // rebuilt the page every thirty seconds, taking the reader's place with it.
  function sameNumbers(a: StatsPayload | undefined, b: StatsPayload): boolean {
    if (!a) return false
    return JSON.stringify({ ...a, generatedAt: 0 }) === JSON.stringify({ ...b, generatedAt: 0 })
  }

  function syncUrl(): void {
    const q = new URLSearchParams({ range })
    if (lang !== ENGLISH) q.set('lang', lang.tag)
    win.history.replaceState(null, '', `?${q.toString()}${win.location.hash}`)
  }

  function setBusy(busy: boolean): void {
    const el = root.querySelector<HTMLElement>('.busy')
    if (el) el.hidden = !busy
  }

  async function load(want: Range): Promise<boolean> {
    try {
      const res = await fetcher(`api/stats?range=${want}`, { headers: { accept: 'application/json' } })
      if (res.status === 503) {
        setBusy(true)
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => void refresh(), retry)
        retry = Math.min(retry * 2, REFRESH_MS)
        return false
      }
      if (!res.ok) return false
      const next = (await res.json()) as StatsPayload
      retry = 2_000
      const changed = !sameNumbers(payloads[want], next)
      payloads[want] = next
      setBusy(false)
      return changed
    } catch {
      // The server is gone (the CLI was stopped). The page keeps what it has.
      return false
    }
  }

  function setRange(next: Range): void {
    if (data.mode === 'static' || payloads[next]) {
      range = next
      syncUrl()
      render()
      if (data.mode === 'server') void refresh()
      return
    }
    pending = load(next).then(() => {
      if (!payloads[next]) return
      range = next
      syncUrl()
      render()
    })
  }

  function refresh(): Promise<void> {
    if (data.mode !== 'server') return Promise.resolve()
    const want = range
    pending = load(want).then((changed) => {
      if (changed && want === range) render()
    })
    return pending
  }

  async function share(): Promise<void> {
    const payload = payloads[range]
    if (!payload) return
    const svg = new Blob([shareCard(payload, lang)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svg)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('share card did not load'))
        img.src = url
      })
      // Twice the size, so the image stays sharp on the high-density screens
      // most people will see it on.
      const canvas = doc.createElement('canvas')
      canvas.width = SHARE_WIDTH * 2
      canvas.height = SHARE_HEIGHT * 2
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!png) return
      const a = doc.createElement('a')
      a.href = URL.createObjectURL(png)
      a.download = `polyglots-stats-${new Date(payload.generatedAt).toISOString().slice(0, 10)}.png`
      doc.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1_000)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function showTip(el: Element): void {
    const title = el.getAttribute('data-tip-title') ?? ''
    const body = el.getAttribute('data-tip-body') ?? ''
    const meta = el.getAttribute('data-tip-meta') ?? ''
    tip.replaceChildren()
    const strong = doc.createElement('strong')
    strong.textContent = title
    tip.append(strong)
    for (const line of [body, meta]) {
      if (line === '') continue
      const p = doc.createElement('span')
      p.textContent = line
      tip.append(p)
    }
    tip.hidden = false
    el.setAttribute('aria-describedby', 'tip')
    const box = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(win.innerWidth - 288, box.left + box.width / 2 - 140))
    tip.style.left = `${left + win.scrollX}px`
    tip.style.top = `${box.bottom + win.scrollY + 8}px`
  }

  function hideTip(): void {
    tip.hidden = true
    for (const el of doc.querySelectorAll('[aria-describedby="tip"]')) el.removeAttribute('aria-describedby')
  }

  const onClick = (e: Event): void => {
    const target = e.target as Element | null
    if (!target || !('closest' in target)) return
    const range = target.closest('[data-range]')
    if (range) {
      e.preventDefault()
      setRange(parseRange(range.getAttribute('data-range')))
      return
    }
    const l = target.closest('[data-lang]')
    if (l) {
      e.preventDefault()
      lang = languageByTag(l.getAttribute('data-lang'), STATS_TRANSLATIONS) ?? ENGLISH
      syncUrl()
      render()
      return
    }
    const theme = target.closest('[data-theme-set]')
    if (theme) {
      store(win, theme.getAttribute('data-theme-set') ?? 'auto')
      applyTheme()
      return
    }
    const sort = target.closest('[data-sort]')
    if (sort) {
      sortBy(sort)
      return
    }
    if (target.closest('[data-share]')) void share()
  }

  const onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement | null
    if (t?.hasAttribute?.('data-filter')) filter(t)
  }

  const onOver = (e: Event): void => {
    const el = (e.target as Element | null)?.closest?.('[data-tip-title]')
    if (el) showTip(el)
  }

  const onOut = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.('[data-tip-title]')) hideTip()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hideTip()
  }

  const onVisible = (): void => {
    if (!doc.hidden) void refresh()
  }

  doc.addEventListener('click', onClick)
  doc.addEventListener('input', onInput)
  doc.addEventListener('mouseover', onOver)
  doc.addEventListener('focusin', onOver)
  doc.addEventListener('mouseout', onOut)
  doc.addEventListener('focusout', onOut)
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('visibilitychange', onVisible)
  win.addEventListener('hashchange', showView)
  const timer = data.mode === 'server' ? setInterval(() => !doc.hidden && void refresh(), REFRESH_MS) : undefined

  // The URL can ask for a range or language the first paint did not use: the
  // standalone copy always paints "all" in English, whatever its query says.
  const wantRange = params.has('range') ? parseRange(params.get('range')) : range
  const wantLang = languageByTag(params.get('lang'), STATS_TRANSLATIONS)
  if (wantLang) lang = wantLang
  if (wantRange !== range || (wantLang && wantLang.tag !== data.lang)) {
    if (payloads[wantRange]) range = wantRange
    render()
  } else {
    applyTheme()
    showView()
  }

  return {
    idle: () => pending,
    stop() {
      clearInterval(timer)
      clearTimeout(retryTimer)
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('input', onInput)
      doc.removeEventListener('mouseover', onOver)
      doc.removeEventListener('focusin', onOver)
      doc.removeEventListener('mouseout', onOut)
      doc.removeEventListener('focusout', onOut)
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('visibilitychange', onVisible)
      win.removeEventListener('hashchange', showView)
    },
  }
}
