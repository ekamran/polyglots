import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { po } from 'gettext-parser'
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser'
import type { DraftEngine, DraftResult, ReviewInput, ReviewResult, TranslationUnit } from '../../../src/types.js'
import type { ReviewOptions } from '../../../src/review/draft-review.js'
import type { TranslateEvent } from '../../../src/commands/translate.js'

export const samplePo = fileURLToPath(new URL('../../fixtures/po/sample.po', import.meta.url))
export const fakeClaude = fileURLToPath(new URL('../../fixtures/fake-claude/claude', import.meta.url))

export const CTX = '\x04'

export const PENDING_KEYS = [
  'Save Changes',
  'Form entries',
  `post type singular name${CTX}Form`,
  'One submission was deleted.',
  'Thank you for installing %s.',
  'Drag fields from the left panel onto the canvas to build your form. You can reorder fields at any time.',
  'You have %1$s new entries. <a href="%2$s">View them</a>.',
]

export interface Workspace {
  home: string
  file: string
  original: Buffer
  cleanup(): Promise<void>
}

export async function makeWorkspace(): Promise<Workspace> {
  const home = await mkdtemp(join(tmpdir(), 'polyglots-translate-'))
  const file = join(home, 'sample.po')
  await copyFile(samplePo, file)
  process.env.POLYGLOTS_HOME = home
  return {
    home,
    file,
    original: await readFile(file),
    cleanup: async () => {
      delete process.env.POLYGLOTS_HOME
      await rm(home, { recursive: true, force: true })
    },
  }
}

export async function parseFile(path: string): Promise<GetTextTranslations> {
  return po.parse(await readFile(path))
}

export function entryOf(parsed: GetTextTranslations, key: string): GetTextTranslation {
  const at = key.indexOf(CTX)
  const ctx = at === -1 ? '' : key.slice(0, at)
  const msgid = at === -1 ? key : key.slice(at + 1)
  const entry = parsed.translations[ctx]?.[msgid]
  if (!entry) throw new Error(`entry not found: ${JSON.stringify(key)}`)
  return entry
}

export function draftFor(unit: TranslationUnit, nplurals: number): string[] {
  if (unit.msgidPlural === undefined) return [`[draft] ${unit.msgid}`]
  return Array.from({ length: nplurals }, (_, i) => `[draft] ${i === 0 ? unit.msgid : unit.msgidPlural}`)
}

export interface FakeEngine extends DraftEngine {
  calls: string[][]
  failWith?: (callIndex: number, units: TranslationUnit[]) => Error | undefined
}

export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    name: 'deepl',
    calls: [],
    async translate(units, _locale, nplurals): Promise<DraftResult[]> {
      const index = engine.calls.length
      engine.calls.push(units.map((u) => u.key))
      const err = engine.failWith?.(index, units)
      if (err) throw err
      return units.map((u) => ({ key: u.key, drafts: draftFor(u, nplurals) }))
    },
  }
  return engine
}

export interface FakeReview {
  (inputs: ReviewInput[], opts: ReviewOptions): Promise<ReviewResult[]>
  calls: { inputs: ReviewInput[]; opts: ReviewOptions }[]
  fuzzyKeys: Set<string>
  failWith?: (callIndex: number, inputs: ReviewInput[]) => Error | undefined | Promise<Error | undefined>
}

export function fakeReview(): FakeReview {
  const review = (async (inputs: ReviewInput[], opts: ReviewOptions) => {
    const index = review.calls.length
    review.calls.push({ inputs, opts })
    const err = await review.failWith?.(index, inputs)
    if (err) throw err
    return inputs.map((i) => ({
      key: i.key,
      text: i.drafts,
      fuzzy: i.msgid.includes('FUZZY') || review.fuzzyKeys.has(i.key),
      reason: 'fake',
    }))
  }) as FakeReview
  review.calls = []
  review.fuzzyKeys = new Set()
  return review
}

export function collect(): { events: TranslateEvent[]; onProgress: (e: TranslateEvent) => void } {
  const events: TranslateEvent[] = []
  return { events, onProgress: (e) => events.push(e) }
}

export function ofType<T extends TranslateEvent['type']>(
  events: TranslateEvent[],
  type: T,
): Extract<TranslateEvent, { type: T }>[] {
  return events.filter((e): e is Extract<TranslateEvent, { type: T }> => e.type === type)
}
