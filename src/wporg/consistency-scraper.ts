import { load } from 'cheerio'
import type { ConsistencyEntry, Locale } from '../types.js'
import { fetchHtml } from './http.js'

const CONSISTENCY_ENDPOINT = 'https://translate.wordpress.org/consistency/'

export function buildConsistencyUrl(text: string, locale: Locale): string {
  const set = locale.includes('/') ? locale : `${locale}/default`
  const params = new URLSearchParams({ search: text, set, project: '' })
  return `${CONSISTENCY_ENDPOINT}?${params.toString()}`
}

export function parseConsistencyHtml(html: string): ConsistencyEntry[] {
  const $ = load(html)
  const groups = new Map<string, ConsistencyEntry>()

  $('table.consistency-table tbody tr').each((_, row) => {
    const cells = $(row).children('td')
    if (cells.length < 2) return

    const translation = cells.eq(1).find('.string').first().text().trim()
    if (!translation) return

    const project = cells.eq(0).find('.meta a').first().text().trim()

    const entry = groups.get(translation) ?? { translation, count: 0, projects: [] }
    entry.count += 1
    if (project) entry.projects.push(project)
    groups.set(translation, entry)
  })

  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export async function fetchConsistency(
  text: string,
  locale: Locale,
  fetch: (url: string) => Promise<string> = fetchHtml,
): Promise<ConsistencyEntry[]> {
  return parseConsistencyHtml(await fetch(buildConsistencyUrl(text, locale)))
}
