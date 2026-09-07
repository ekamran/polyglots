import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../../src/types.js'
import {
  dedupeGlossaryEntries,
  fetchGlossary,
  glossaryUrl,
  nextPageUrl,
  parseGlossaryHtml,
  parseGlossaryPage,
} from '../../src/wporg/glossary-scraper.js'

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/wporg/glossary-tr.html', import.meta.url)),
  'utf8',
)

const BASE = 'https://translate.wordpress.org/locale/tr/default/glossary/'

const find = (entries: GlossaryEntry[], term: string, pos?: string) =>
  entries.find((e) => e.sourceTerm === term && (pos === undefined || e.partOfSpeech === pos))

const findAll = (entries: GlossaryEntry[], term: string, pos: string) =>
  entries.filter((e) => e.sourceTerm === term && e.partOfSpeech === pos)

const row = (term: string, translation: string, pos = 'noun', notes = '') =>
  `<tr class="view"><td>${term}</td><td>${pos}</td><td>${translation}</td><td>${notes}</td><td></td></tr>`

const page = (rows: string, nav = '') =>
  `<table id="glossary" class="gp-table glossary"><tbody>${rows}</tbody></table>${nav}`

describe('parseGlossaryHtml', () => {
  const entries = parseGlossaryHtml(fixture, 'tr')

  it('emits every view row of the frozen fixture verbatim, duplicates included', () => {
    expect(entries.length).toBe(513)
  })

  it('extracts known source -> translation pairs', () => {
    expect(find(entries, 'plugin')).toMatchObject({ translation: 'eklenti', partOfSpeech: 'noun' })
    expect(find(entries, 'theme')).toMatchObject({ translation: 'tema' })
    expect(find(entries, 'permalink')).toMatchObject({ translation: 'kalıcı bağlantı' })
    expect(find(entries, 'sidebar')).toMatchObject({ translation: 'kenar çubuğu' })
    expect(find(entries, 'pagination')).toMatchObject({ translation: 'sayfalama' })
    expect(find(entries, 'slug')).toMatchObject({ translation: 'adres son eki' })
  })

  it('keeps the same term with different parts of speech as separate entries', () => {
    expect(find(entries, 'comment', 'noun')).toMatchObject({ translation: 'yorum' })
    expect(find(entries, 'comment', 'verb')).toMatchObject({ translation: 'yorum yap' })
    expect(find(entries, 'post', 'noun')).toMatchObject({ translation: 'yazı' })
    expect(find(entries, 'post', 'verb')).toMatchObject({ translation: 'gönder' })
  })

  it('keeps the same term and part of speech with different translations as separate entries', () => {
    expect(findAll(entries, 'author', 'noun').map((e) => e.translation)).toEqual(['yazar', 'geliştirici'])
    expect(findAll(entries, 'tag', 'noun').map((e) => e.translation)).toEqual(['etiket', 'kod imi'])
    expect(findAll(entries, 'key', 'noun').map((e) => e.translation)).toEqual(['anahtar', 'tuş'])
    expect(findAll(entries, 'directory', 'noun').map((e) => e.translation)).toEqual(['dizin', 'klasör'])
  })

  it('preserves source term casing as published', () => {
    expect(find(entries, 'Border', 'noun')).toBeDefined()
    expect(find(entries, 'border')).toBeUndefined()
  })

  it('populates partOfSpeech and locale on every entry', () => {
    for (const e of entries) {
      expect(e.locale).toBe('tr')
      expect(e.partOfSpeech).toBeTruthy()
      expect(e.sourceTerm).toBeTruthy()
      expect(e.translation).toBeTruthy()
    }
  })

  it('carries comments as notes, decoded and trimmed, and omits notes when empty', () => {
    expect(find(entries, 'widget')).toMatchObject({
      translation: 'gereç',
      notes: 'Eski kullanım bileşen, element ile çakışıyor',
    })
    expect(find(entries, 'sidebar')?.notes).toBe('"yan çubuk"')
    expect(find(entries, 'plugin')).not.toHaveProperty('notes')
  })

  it('never produces leading/trailing or doubled whitespace', () => {
    for (const e of entries) {
      for (const v of [e.sourceTerm, e.translation, e.partOfSpeech, e.notes]) {
        if (v === undefined) continue
        expect(v).toBe(v.trim())
        expect(v).not.toMatch(/\s{2,}/)
      }
    }
  })

  it('collapses internal whitespace and skips rows without a translation', () => {
    const html = `
      <table id="glossary" class="gp-table glossary"><tbody>
        <tr class="view" data-id="1"><td>  custom
          post   type </td><td>noun</td><td> özel
          yazı   tipi </td><td> a  b </td><td class="date-modified">x</td></tr>
        <tr class="view" data-id="2"><td>orphan</td><td>noun</td><td>   </td><td></td><td></td></tr>
        <tr class="view" data-id="3"><td></td><td>noun</td><td>çeviri</td><td></td><td></td></tr>
        <tr class="view" data-id="4"><td>bare</td><td></td><td>çıplak</td><td></td><td></td></tr>
        <tr id="editor-1" class="hide-if-js editor"><td colspan="6"><input value="ignored"></td></tr>
      </tbody></table>`
    expect(parseGlossaryHtml(html, 'de')).toEqual([
      { locale: 'de', sourceTerm: 'custom post type', translation: 'özel yazı tipi', partOfSpeech: 'noun', notes: 'a b' },
      { locale: 'de', sourceTerm: 'bare', translation: 'çıplak' },
    ])
  })

  it('returns [] for empty or garbage html', () => {
    expect(parseGlossaryHtml('', 'tr')).toEqual([])
    expect(parseGlossaryHtml('<<<not html>>> &&& <table><tr><td>x</td></tr></table>', 'tr')).toEqual([])
    expect(parseGlossaryHtml('<html><body><p>nothing here</p></body></html>', 'tr')).toEqual([])
  })
})

describe('dedupeGlossaryEntries', () => {
  const e = (sourceTerm: string, translation: string, extra: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
    locale: 'tr',
    sourceTerm,
    translation,
    partOfSpeech: 'noun',
    ...extra,
  })

  it('collapses rows identical in locale, term, part of speech and translation, keeping first-seen order', () => {
    expect(dedupeGlossaryEntries([e('image', 'görsel'), e('theme', 'tema'), e('image', 'görsel')])).toEqual([
      e('image', 'görsel'),
      e('theme', 'tema'),
    ])
  })

  it('fills in notes from a later duplicate when the kept entry has none', () => {
    expect(dedupeGlossaryEntries([e('account', 'hesap'), e('account', 'hesap', { notes: 'ctx' })])).toEqual([
      e('account', 'hesap', { notes: 'ctx' }),
    ])
    expect(dedupeGlossaryEntries([e('account', 'hesap', { notes: 'first' }), e('account', 'hesap', { notes: 'second' })])).toEqual([
      e('account', 'hesap', { notes: 'first' }),
    ])
  })

  it('keeps alternates that differ in translation, part of speech, case or locale', () => {
    const input = [
      e('author', 'yazar'),
      e('author', 'geliştirici'),
      e('post', 'gönder', { partOfSpeech: 'verb' }),
      e('post', 'yazı'),
      e('Post', 'Yazı'),
      e('post', 'yazı', { locale: 'az' }),
    ]
    expect(dedupeGlossaryEntries(input)).toEqual(input)
  })

  it('does not mutate its input', () => {
    const first = e('image', 'görsel')
    dedupeGlossaryEntries([first, e('image', 'görsel', { notes: 'x' })])
    expect(first).not.toHaveProperty('notes')
  })

  it('reduces the fixture to 511 entries, merging the two known duplicates without losing alternates', () => {
    const deduped = dedupeGlossaryEntries(parseGlossaryHtml(fixture, 'tr'))
    expect(deduped).toHaveLength(511)
    expect(findAll(deduped, 'image', 'noun')).toEqual([{ locale: 'tr', sourceTerm: 'image', partOfSpeech: 'noun', translation: 'görsel' }])
    expect(findAll(deduped, 'account recovery', 'noun')).toHaveLength(1)
    expect(find(deduped, 'account recovery')?.notes).toMatch(/^Parola unutulduğunda/)
    expect(findAll(deduped, 'author', 'noun').map((x) => x.translation)).toEqual(['yazar', 'geliştirici'])
    expect(findAll(deduped, 'header', 'noun').map((x) => x.translation)).toEqual(['başlık', 'üst kısım'])
  })
})

describe('glossaryUrl', () => {
  it('builds the per-locale default glossary url', () => {
    expect(glossaryUrl('tr')).toBe(BASE)
    expect(glossaryUrl('de')).toBe('https://translate.wordpress.org/locale/de/default/glossary/')
  })

  it('encodes locale slugs', () => {
    expect(glossaryUrl('pt-br')).toBe('https://translate.wordpress.org/locale/pt-br/default/glossary/')
    expect(glossaryUrl('a/b')).toBe('https://translate.wordpress.org/locale/a%2Fb/default/glossary/')
  })
})

describe('nextPageUrl', () => {
  it('returns undefined when the page has no pagination', () => {
    expect(nextPageUrl(fixture, BASE)).toBeUndefined()
    expect(nextPageUrl(page(row('one', 'bir')), BASE)).toBeUndefined()
  })

  it('prefers a.next, then a[rel=next], then the sibling after .current', () => {
    const all = `
      <div class="paging"><span class="current">1</span><a href="${BASE}page/4/">4</a></div>
      <a rel="next" href="${BASE}page/3/">rel</a>
      <a class="next" href="${BASE}page/2/">next</a>`
    expect(nextPageUrl(all, BASE)).toBe(`${BASE}page/2/`)

    const relOnly = `<a rel="next" href="${BASE}page/3/">rel</a><div class="paging"><span class="current">1</span><a href="${BASE}page/4/">4</a></div>`
    expect(nextPageUrl(relOnly, BASE)).toBe(`${BASE}page/3/`)

    const pagingOnly = `<div class="paging"><a href="${BASE}">1</a><span class="current">2</span><a href="${BASE}page/3/">3</a></div>`
    expect(nextPageUrl(pagingOnly, BASE)).toBe(`${BASE}page/3/`)

    const paginationOnly = `<nav class="pagination"><span class="current">2</span><a href="${BASE}page/3/">3</a></nav>`
    expect(nextPageUrl(paginationOnly, BASE)).toBe(`${BASE}page/3/`)
  })

  it('returns undefined when .current is the last item or is followed by a non-link', () => {
    expect(nextPageUrl(`<div class="paging"><a href="${BASE}">1</a><span class="current">2</span></div>`, BASE)).toBeUndefined()
    expect(nextPageUrl(`<div class="paging"><span class="current">1</span><span>…</span><a href="${BASE}page/3/">3</a></div>`, BASE)).toBeUndefined()
  })

  it('resolves relative hrefs against the current url and strips fragments', () => {
    expect(nextPageUrl('<a class="next" href="page/2/">n</a>', BASE)).toBe(`${BASE}page/2/`)
    expect(nextPageUrl('<a class="next" href="/locale/tr/default/glossary/page/2/#glossary">n</a>', BASE)).toBe(`${BASE}page/2/`)
    expect(nextPageUrl('<a class="next" href="?page=2">n</a>', BASE)).toBe(`${BASE}?page=2`)
  })

  it('rejects hrefs off translate.wordpress.org, including scheme and subdomain tricks', () => {
    for (const href of [
      'https://evil.example/page/2/',
      'http://translate.wordpress.org/locale/tr/default/glossary/page/2/',
      'https://translate.wordpress.org.evil.example/x',
      'https://sub.translate.wordpress.org/x',
      '//evil.example/x',
      'javascript:alert(1)',
      'mailto:x@y',
    ]) {
      expect(nextPageUrl(`<a class="next" href="${href}">n</a>`, BASE), href).toBeUndefined()
    }
  })

  it('ignores an unparsable href instead of throwing', () => {
    expect(nextPageUrl('<a class="next" href="https://">n</a>', BASE)).toBeUndefined()
    expect(nextPageUrl('<a class="next" href="">n</a>', BASE)).toBeUndefined()
  })
})

describe('parseGlossaryPage', () => {
  it('returns entries and the resolved next url from one parse', () => {
    const html = page(row('one', 'bir'), `<a class="next" href="page/2/">Next</a>`)
    expect(parseGlossaryPage(html, 'tr', BASE)).toEqual({
      entries: [{ locale: 'tr', sourceTerm: 'one', translation: 'bir', partOfSpeech: 'noun' }],
      nextUrl: `${BASE}page/2/`,
    })
  })

  it('omits nextUrl on the last page and handles empty html', () => {
    expect(parseGlossaryPage(page(row('one', 'bir')), 'tr', BASE)).toEqual({
      entries: [{ locale: 'tr', sourceTerm: 'one', translation: 'bir', partOfSpeech: 'noun' }],
    })
    expect(parseGlossaryPage('   ', 'tr', BASE)).toEqual({ entries: [] })
  })
})

describe('fetchGlossary', () => {
  const recording = (pages: Record<string, string>) => {
    const calls: string[] = []
    const fetch = async (url: string) => {
      calls.push(url)
      const html = pages[url]
      if (html === undefined) throw new Error(`unexpected url ${url}`)
      return html
    }
    return { calls, fetch }
  }

  it('fetches the locale glossary url with the injected fetch and returns deduped entries', async () => {
    const { calls, fetch } = recording({ [BASE]: fixture })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE])
    expect(entries).toEqual(dedupeGlossaryEntries(parseGlossaryHtml(fixture, 'tr')))
    expect(entries).toHaveLength(511)
  })

  it('passes the locale through to the url and to every entry', async () => {
    const { calls, fetch } = recording({
      'https://translate.wordpress.org/locale/de/default/glossary/': page(row('one', 'eins')),
    })
    const entries = await fetchGlossary('de', fetch)
    expect(calls).toEqual(['https://translate.wordpress.org/locale/de/default/glossary/'])
    expect(entries).toEqual([{ locale: 'de', sourceTerm: 'one', translation: 'eins', partOfSpeech: 'noun' }])
  })

  it('follows a.next pagination links and concatenates pages in order', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<div class="paging"><span class="current">1</span><a href="${BASE}page/2/">2</a><a class="next" href="${BASE}page/2/">Next</a></div>`),
      [`${BASE}page/2/`]: page(row('two', 'iki'), `<div class="paging"><a href="${BASE}">1</a><span class="current">2</span><a class="next" href="${BASE}page/3/">Next</a></div>`),
      [`${BASE}page/3/`]: page(row('three', 'üç'), `<div class="paging"><a href="${BASE}page/2/">2</a><span class="current">3</span></div>`),
    })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE, `${BASE}page/2/`, `${BASE}page/3/`])
    expect(entries.map((e) => `${e.sourceTerm}=${e.translation}`)).toEqual(['one=bir', 'two=iki', 'three=üç'])
  })

  it('follows a[rel=next] when there is no a.next', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<a rel="next" href="page/2/">Next</a>`),
      [`${BASE}page/2/`]: page(row('two', 'iki')),
    })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE, `${BASE}page/2/`])
    expect(entries.map((e) => e.sourceTerm)).toEqual(['one', 'two'])
  })

  it('follows the link after .current when there is neither a.next nor a[rel=next]', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<div class="pagination"><span class="current">1</span><a href="page/2/">2</a></div>`),
      [`${BASE}page/2/`]: page(row('two', 'iki'), `<div class="pagination"><a href="${BASE}">1</a><span class="current">2</span></div>`),
    })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE, `${BASE}page/2/`])
    expect(entries.map((e) => e.sourceTerm)).toEqual(['one', 'two'])
  })

  it('merges duplicates that span pages', async () => {
    const { fetch } = recording({
      [BASE]: page(row('image', 'görsel'), `<a class="next" href="page/2/">Next</a>`),
      [`${BASE}page/2/`]: page(row('image', 'görsel', 'noun', 'ctx') + row('image', 'resim')),
    })
    expect(await fetchGlossary('tr', fetch)).toEqual([
      { locale: 'tr', sourceTerm: 'image', translation: 'görsel', partOfSpeech: 'noun', notes: 'ctx' },
      { locale: 'tr', sourceTerm: 'image', translation: 'resim', partOfSpeech: 'noun' },
    ])
  })

  it('stops when a next link points back to an already fetched page', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<a class="next" href="page/2/">Next</a>`),
      [`${BASE}page/2/`]: page(row('two', 'iki'), `<a class="next" href="${BASE}">Next</a>`),
    })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE, `${BASE}page/2/`])
    expect(entries).toHaveLength(2)
  })

  it('stops when a page links to itself', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<a class="next" href="${BASE}#top">Next</a>`),
    })
    await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE])
  })

  it('caps crawling at 50 pages even when every page advertises a next link', async () => {
    const calls: string[] = []
    const fetch = async (url: string) => {
      calls.push(url)
      const n = calls.length
      return page(row(`term${n}`, `çeviri${n}`), `<a class="next" href="${BASE}page/${n + 1}/">Next</a>`)
    }
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toHaveLength(50)
    expect(calls[49]).toBe(`${BASE}page/50/`)
    expect(entries).toHaveLength(50)
  })

  it('does not follow next links pointing off translate.wordpress.org', async () => {
    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<a class="next" href="https://evil.example/page/2/">Next</a>`),
    })
    const entries = await fetchGlossary('tr', fetch)
    expect(calls).toEqual([BASE])
    expect(entries).toHaveLength(1)
  })

  it('propagates fetch failures, including on a later page', async () => {
    await expect(fetchGlossary('tr', async () => { throw new Error('boom') })).rejects.toThrow('boom')

    const { calls, fetch } = recording({
      [BASE]: page(row('one', 'bir'), `<a class="next" href="page/2/">Next</a>`),
    })
    await expect(fetchGlossary('tr', fetch)).rejects.toThrow(`unexpected url ${BASE}page/2/`)
    expect(calls).toEqual([BASE, `${BASE}page/2/`])
  })
})
