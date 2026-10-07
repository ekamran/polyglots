import * as cheerio from 'cheerio'
import { splitLocale } from './locales.js'
import type { CheerioAPI } from 'cheerio'
import type { GlossaryEntry, Locale } from '../types.js'
import { fetchHtml } from './http.js'

const ORIGIN = 'https://translate.wordpress.org'
const MAX_PAGES = 50

export type FetchPage = (url: string) => Promise<string>

export interface GlossaryPage {
  entries: GlossaryEntry[]
  nextUrl?: string
}

export function glossaryUrl(locale: Locale): string {
  // A variant set has its own glossary: nl/formal differs from nl.
  const { slug, set } = splitLocale(locale)
  return `${ORIGIN}/locale/${encodeURIComponent(slug)}/${encodeURIComponent(set)}/glossary/`
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

function entriesFrom($: CheerioAPI, locale: Locale): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []

  $('table#glossary tbody tr.view, table.glossary tbody tr.view').each((_, row) => {
    const cells = $(row).children('td')
    if (cells.length < 3) return

    const sourceTerm = clean(cells.eq(0).text())
    const partOfSpeech = clean(cells.eq(1).text())
    const translation = clean(cells.eq(2).text())
    const notes = clean(cells.eq(3).text())
    if (!sourceTerm || !translation) return

    const entry: GlossaryEntry = { locale, sourceTerm, translation }
    if (partOfSpeech) entry.partOfSpeech = partOfSpeech
    if (notes) entry.notes = notes
    entries.push(entry)
  })

  return entries
}

function nextUrlFrom($: CheerioAPI, currentUrl: string): string | undefined {
  const href =
    $('a.next[href]').first().attr('href') ??
    $('a[rel="next"][href]').first().attr('href') ??
    $('.paging .current, .pagination .current').first().next('a[href]').attr('href')
  if (!href) return undefined

  let resolved: URL
  try {
    resolved = new URL(href, currentUrl)
  } catch {
    return undefined
  }
  if (resolved.origin !== ORIGIN) return undefined
  resolved.hash = ''
  return resolved.href
}

export function parseGlossaryPage(html: string, locale: Locale, currentUrl: string): GlossaryPage {
  if (!html.trim()) return { entries: [] }
  const $ = cheerio.load(html)
  const page: GlossaryPage = { entries: entriesFrom($, locale) }
  const nextUrl = nextUrlFrom($, currentUrl)
  if (nextUrl) page.nextUrl = nextUrl
  return page
}

export function parseGlossaryHtml(html: string, locale: Locale): GlossaryEntry[] {
  if (!html.trim()) return []
  return entriesFrom(cheerio.load(html), locale)
}

export function nextPageUrl(html: string, currentUrl: string): string | undefined {
  return nextUrlFrom(cheerio.load(html), currentUrl)
}

const identity = (e: GlossaryEntry): string =>
  JSON.stringify([e.locale, e.sourceTerm, e.partOfSpeech ?? '', e.translation])

export function dedupeGlossaryEntries(entries: GlossaryEntry[]): GlossaryEntry[] {
  const kept = new Map<string, GlossaryEntry>()
  for (const entry of entries) {
    const key = identity(entry)
    const existing = kept.get(key)
    if (!existing) {
      kept.set(key, { ...entry })
    } else if (!existing.notes && entry.notes) {
      existing.notes = entry.notes
    }
  }
  return [...kept.values()]
}

export async function fetchGlossary(locale: Locale, fetch: FetchPage = fetchHtml): Promise<GlossaryEntry[]> {
  const entries: GlossaryEntry[] = []
  const visited = new Set<string>()
  let url: string | undefined = glossaryUrl(locale)

  while (url && !visited.has(url) && visited.size < MAX_PAGES) {
    visited.add(url)
    const page = parseGlossaryPage(await fetch(url), locale, url)
    entries.push(...page.entries)
    url = page.nextUrl
  }

  return dedupeGlossaryEntries(entries)
}
