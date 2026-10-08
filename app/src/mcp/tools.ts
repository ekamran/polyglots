import type Database from 'better-sqlite3'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ConsistencyEntry, ConsistencyScope, Locale } from '../types.js'
import { getConsistency, lookupGlossary, searchTm, setConsistency } from '../storage/index.js'
import { normalizeLocale } from '../tmx/parse.js'
import { fetchConsistency as defaultFetchConsistency } from '../wporg/consistency-scraper.js'

export interface ToolDeps {
  db: Database.Database
  // The run's locale. Absent for a server started with no POLYGLOTS_LOCALE
  // and no configured locale, where every call must name its own.
  locale?: Locale
  ttlDays: number
  fetchConsistency?: typeof defaultFetchConsistency
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

const localeArg = z.string().min(1).optional().describe('Target locale code; defaults to the run locale.')

// translate.wordpress.org must never see parallel requests from one review batch, and claude
// issues tool calls concurrently, so fetches go through one queue with in-flight dedupe.
function createConsistencyLookup(deps: ToolDeps, fetchConsistency: typeof defaultFetchConsistency) {
  const inflight = new Map<string, Promise<ConsistencyEntry[]>>()
  let queue: Promise<unknown> = Promise.resolve()

  const fetchAndCache = async (text: string, locale: Locale, scope: ConsistencyScope): Promise<ConsistencyEntry[]> => {
    const cached = getConsistency(deps.db, text, locale, deps.ttlDays, scope)
    if (cached) return cached
    const entries = await fetchConsistency(text, locale, undefined, scope)
    if (entries.length > 0) setConsistency(deps.db, text, locale, entries, scope)
    return entries
  }

  return (text: string, locale: Locale, scope: ConsistencyScope): Promise<ConsistencyEntry[]> => {
    const cached = getConsistency(deps.db, text, locale, deps.ttlDays, scope)
    if (cached) return Promise.resolve(cached)
    const key = `${scope}\0${locale}\0${text}`
    const pending = inflight.get(key)
    if (pending) return pending
    const run = queue.then(() => fetchAndCache(text, locale, scope))
    queue = run.catch(() => undefined)
    inflight.set(key, run)
    void run.finally(() => inflight.delete(key)).catch(() => undefined)
    return run
  }
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const lookupConsistency = createConsistencyLookup(deps, deps.fetchConsistency ?? defaultFetchConsistency)
  const defaultLocale = deps.locale === undefined ? undefined : normalizeLocale(deps.locale)
  // Refused rather than guessed: a lookup in the wrong locale returns another
  // language's approved wording, which the model would then hold up as
  // authoritative. Thrown inside each handler, so it reaches the agent as a
  // tool error it can act on rather than ending the server.
  const resolveLocale = (locale?: string): Locale => {
    if (locale) return normalizeLocale(locale)
    if (defaultLocale !== undefined) return defaultLocale
    throw new Error('No locale: pass the locale argument, or start the server with POLYGLOTS_LOCALE set')
  }

  server.registerTool(
    'glossary_lookup',
    {
      description:
        'Look up the official translate.wordpress.org glossary for a source term; call it whenever a draft contains a WordPress term whose approved translation you are not certain of.',
      inputSchema: {
        term: z.string().min(1).describe('English source term or phrase to look up.'),
        locale: localeArg,
      },
    },
    ({ term, locale }) => {
      try {
        return json(lookupGlossary(deps.db, term, resolveLocale(locale)))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'consistency_lookup',
    {
      description:
        'Check how an exact source string is already translated on translate.wordpress.org, as {translation, count} pairs. Defaults to WordPress core, whose translations are reviewed by the locale team and are authoritative. Call it only when the glossary has no answer for the wording, and widen to scope "all" only if core returns nothing.',
      inputSchema: {
        text: z.string().min(1).describe('Exact English source string to check.'),
        locale: localeArg,
        scope: z
          .enum(['core', 'all'])
          .optional()
          .describe(
            'core (default) = WordPress core only, reviewed and authoritative. all = every plugin and theme, translated by their authors without review, so treat it as weak evidence and expect conflicting variants.',
          ),
      },
    },
    async ({ text, locale, scope }) => {
      try {
        return json(await lookupConsistency(text, resolveLocale(locale), scope ?? 'core'))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'tm_lookup',
    {
      description:
        'Search the local translation memory for near-matching source strings; call it to reuse wording from previously approved translations of similar strings.',
      inputSchema: {
        text: z.string().min(1).describe('Source string to find similar translation-memory entries for.'),
        locale: localeArg,
        limit: z.number().int().positive().max(50).optional().describe('Maximum matches to return (default 5).'),
      },
    },
    ({ text, locale, limit }) => {
      try {
        return json(searchTm(deps.db, text, resolveLocale(locale), limit ?? 5))
      } catch (error) {
        return failure(error)
      }
    },
  )
}
