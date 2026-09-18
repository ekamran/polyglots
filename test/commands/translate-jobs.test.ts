import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { openDb, replaceGlossary } from '../../src/storage/index.js'
import { translateFile } from '../../src/commands/translate.js'
import type { DraftEngine, ReviewInput, ReviewResult } from '../../src/types.js'

let dir: string
let jobsDb: Database.Database
let db: Database.Database

const PO = `msgid ""
msgstr ""
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"

msgid "Save"
msgstr ""

msgid "Cancel"
msgstr ""
`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-translate-jobs-'))
  jobsDb = openJobsDb(join(dir, 'jobs.db'))
  db = openDb(join(dir, 'polyglots.db'))
  replaceGlossary(db, 'tr', [{ sourceTerm: 'Save', translation: 'Kaydet', locale: 'tr' }])
  await writeFile(join(dir, 'plugin-tr.po'), PO)
})

afterEach(async () => {
  jobsDb.close()
  db.close()
  await rm(dir, { recursive: true, force: true })
})

// DraftEngine.name is the union 'deepl' | 'openai', not a free string, so a
// fake still has to claim one of them.
const engine = (): DraftEngine => ({
  name: 'deepl',
  translate: async (units) => units.map((u) => ({ key: u.key, drafts: [`${u.msgid}-tr`] })),
})

const review = async (inputs: ReviewInput[]): Promise<ReviewResult[]> =>
  inputs.map((i) => ({ key: i.key, text: i.drafts, fuzzy: false, reason: '' }))

const run = (fake: DraftEngine, reviewDrafts: typeof review, mode: 'pending' | 'all' = 'pending') =>
  translateFile({
    file: join(dir, 'plugin-tr.po'),
    locale: 'tr',
    mode,
    draftEngine: 'deepl',
    engine: fake,
    // The injected seam is called `review`, not `reviewBatch`.
    review: reviewDrafts as never,
    db,
    jobsDb,
    mcpConfigPath: '',
  })

describe('translate backed by the job store', () => {
  it('does not re-draft an entry it has already drafted', async () => {
    await run(engine(), review)
    const second = engine()
    const translate = vi.fn(second.translate)
    // `mode: 'pending'` would find nothing left to do on an unchanged file
    // and skip drafting entirely regardless of the cache, which would let
    // this pass with the feature removed. `mode: 'all'` forces both entries
    // back through draft() so the assertion actually exercises the cache.
    await run({ ...second, translate }, review, 'all')
    expect(translate).not.toHaveBeenCalled()
  })

  it('does not re-review a draft it has already reviewed', async () => {
    await run(engine(), review)
    const reviewDrafts = vi.fn(review)
    // Same reasoning as above: 'all' is required so the entries are actually
    // resubmitted, giving the review cache something to be tested against.
    await run(engine(), reviewDrafts, 'all')
    expect(reviewDrafts).not.toHaveBeenCalled()
  })

  it('re-drafts only the entry whose source changed', async () => {
    await run(engine(), review)
    await writeFile(join(dir, 'plugin-tr.po'), PO.replace('msgid "Cancel"', 'msgid "Dismiss"'))
    const second = engine()
    const translate = vi.fn(second.translate)
    await run({ ...second, translate }, review)
    const asked = translate.mock.calls.flatMap(([units]) => units.map((u) => u.msgid))
    expect(asked).toEqual(['Dismiss'])
  })

  it('records the run in history', async () => {
    await run(engine(), review)
    const row = jobsDb
      .prepare<[], { command: string; state: string }>('SELECT command, state FROM run ORDER BY id DESC LIMIT 1')
      .get()!
    expect(row.command).toBe('translate')
    expect(row.state).toBe('done')
  })
})
