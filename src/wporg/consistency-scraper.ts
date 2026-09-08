import { load } from 'cheerio'
import type { ConsistencyEntry, ConsistencyScope, Locale } from '../types.js'
import { fetchHtml } from './http.js'

const CONSISTENCY_ENDPOINT = 'https://translate.wordpress.org/consistency/'

// GlotPress project id 1 is WordPress core, whose translations are review-gated by the
// locale team. Everything else is plugin/theme authors translating unsupervised, so an
// unfiltered query mixes authority with noise ("Sidebar" -> 8 variants instead of 1).
const CORE_PROJECT_ID = '1'

export function buildConsistencyUrl(text: string, locale: Locale, scope: ConsistencyScope = 'core'): string {
  const set = locale.includes('/') ? locale : `${locale}/default`
  const params = new URLSearchParams({ search: text, set, project: scope === 'core' ? CORE_PROJECT_ID : '' })
  return `${CONSISTENCY_ENDPOINT}?${params.toString()}`
}

export function parseConsistencyHtml(html: string): ConsistencyEntry[] {
  const $ = load(html)
  const counts = new Map<string, number>()

  $('table.consistency-table tbody tr').each((_, row) => {
    const cells = $(row).children('td')
    if (cells.length < 2) return

    const translation = cells.eq(1).find('.string').first().text().trim()
    if (!translation) return

    counts.set(translation, (counts.get(translation) ?? 0) + 1)
  })

  return [...counts]
    .map(([translation, count]) => ({ translation, count }))
    .sort((a, b) => b.count - a.count)
}

export async function fetchConsistency(
  text: string,
  locale: Locale,
  fetch: (url: string) => Promise<string> = fetchHtml,
  scope: ConsistencyScope = 'core',
): Promise<ConsistencyEntry[]> {
  return parseConsistencyHtml(await fetch(buildConsistencyUrl(text, locale, scope)))
}
