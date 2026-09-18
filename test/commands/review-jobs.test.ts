import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../src/jobs/db.js'
import { loadPo } from '../../src/po/po-file.js'
import { openDb, replaceGlossary } from '../../src/storage/index.js'
import { reviewFile } from '../../src/commands/review.js'
import type { Adjudicator } from '../../src/audit/audit.js'

let dir: string
let jobsDb: Database.Database
let db: Database.Database

const PO = `msgid ""
msgstr ""
"Project-Id-Version: Plugins - Thing - Stable\\n"
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"

msgid "Save"
msgstr "Kaydet"

msgid "Cancel"
msgstr "Iptal"
`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-review-jobs-'))
  jobsDb = openJobsDb(join(dir, 'jobs.db'))
  db = openDb(join(dir, 'polyglots.db'))
  replaceGlossary(db, 'tr', [{ sourceTerm: 'Settings', translation: 'Ayarlar', locale: 'tr' }])
  await writeFile(join(dir, 'plugin-tr.po'), PO)
})

afterEach(async () => {
  jobsDb.close()
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const clean: Adjudicator = async (batch) =>
  batch.map((c) => ({ id: c.id, problem: false, categories: [], reason: '' }))

const run = (adjudicate: Adjudicator) =>
  reviewFile({
    file: join(dir, 'plugin-tr.po'),
    locale: 'tr',
    db,
    jobsDb,
    adjudicate,
    mcpConfigPath: '',
  })

describe('review backed by the job store', () => {
  it('records a run in history with its project name', async () => {
    await run(clean)
    const row = jobsDb
      .prepare<[], { project: string; state: string; entries: number }>(
        'SELECT project, state, entries FROM run ORDER BY id DESC LIMIT 1',
      )
      .get()!
    expect(row.project).toBe('Plugins - Thing - Stable')
    expect(row.state).toBe('done')
    expect(row.entries).toBe(2)
  })

  it('freezes totals that match the summary the caller was given', async () => {
    const summary = await run(clean)
    const row = jobsDb
      .prepare<[], { flagged: number; approvable: number }>(
        'SELECT flagged, approvable FROM run ORDER BY id DESC LIMIT 1',
      )
      .get()!
    expect(row.flagged).toBe(summary.problems)
    expect(row.approvable).toBe(summary.approvable)
  })

  it('does not re-ask the model when the same file is reviewed again', async () => {
    await run(clean)
    const adjudicate = vi.fn(clean)
    await run(adjudicate)
    expect(adjudicate).not.toHaveBeenCalled()
  })

  it('re-asks only about an entry whose translation changed', async () => {
    await run(clean)
    await writeFile(join(dir, 'plugin-tr.po'), PO.replace('"Iptal"', '"Vazgec"'))
    const adjudicate = vi.fn(clean)
    await run(adjudicate)
    const asked = adjudicate.mock.calls.flatMap(([batch]) => batch.map((c) => c.key))
    expect(asked).toEqual(['Cancel'])
  })

  it('reaches the same summary from the cache as from the model', async () => {
    const first = await run(clean)
    const second = await run(clean)
    expect(second).toEqual(first)
  })

  it('starts fresh when --fresh is given, even with a full cache', async () => {
    await run(clean)
    const adjudicate = vi.fn(clean)
    await reviewFile({
      file: join(dir, 'plugin-tr.po'),
      locale: 'tr',
      db,
      jobsDb,
      adjudicate,
      mcpConfigPath: '',
      fresh: true,
    })
    expect(adjudicate).toHaveBeenCalled()
  })

  // A repair exists nowhere but the output file it was written into, so a
  // second run that fails to carry it forward silently reverts a correction in
  // the user's translation. That used to mean reading the previous file back;
  // now it means replaying the cached verdict through onCached, so this checks
  // that route rather than the file.
  it('keeps a model-made repair once its verdict is cached', async () => {
    const repairs: Adjudicator = async (batch) =>
      batch.map((c) =>
        c.key === 'Cancel'
          ? { id: c.id, problem: true, categories: ['meaning'], reason: 'says the opposite', fix: ['Vazgec'] }
          : { id: c.id, problem: false, categories: [], reason: '' },
      )

    const first = await run(repairs)
    expect(first.repaired).toBe(1)
    const before = await readFile(join(dir, 'plugin-tr-repaired.po'), 'utf8')
    expect(before).toContain('Vazgec')

    const adjudicate = vi.fn(repairs)
    const second = await run(adjudicate)
    expect(adjudicate).not.toHaveBeenCalled()
    expect(second.repaired).toBe(1)
    const after = await readFile(join(dir, 'plugin-tr-repaired.po'), 'utf8')
    expect(after).toContain('Vazgec')
  })

  // A whitespace repair the rules make outright is neither a problem nor a
  // guess, and it is recomputed from the source on every call rather than
  // stored in the cache. This checks it still survives once the model's own
  // verdict for the entry comes back from a fully warm cache instead of a
  // fresh call.
  it('keeps a repair the rules made outright, even once the model cache is warm', async () => {
    await writeFile(join(dir, 'plugin-tr.po'), PO.replace('"Kaydet"', '"Kaydet "'))

    const first = await run(clean)
    expect(first.repaired).toBe(1)
    const before = await loadPo(join(dir, 'plugin-tr-repaired.po'))
    expect(before.auditEntries().map((e) => e.msgid)).toContain('Save')

    const adjudicate = vi.fn(clean)
    const second = await run(adjudicate)
    expect(adjudicate).not.toHaveBeenCalled()
    expect(second.repaired).toBe(1)

    const after = await loadPo(join(dir, 'plugin-tr-repaired.po'))
    const entry = after.auditEntries().find((e) => e.msgid === 'Save')
    expect(entry?.msgstr).toEqual(['Kaydet'])
    const text = await readFile(join(dir, 'plugin-tr-repaired.po'), 'utf8')
    expect(text).toMatch(/polyglots:.*whitespace/i)
  })

  // A model may flag an entry with no categories at all, leaving it with no
  // findings of its own. It must still show up, with a legible reason, once
  // that verdict comes back from the cache instead of the model.
  it('keeps an entry the model flagged without naming a category, once cached', async () => {
    const bare: Adjudicator = async (batch) =>
      batch.map((c) =>
        c.key === 'Cancel'
          ? { id: c.id, problem: true, categories: [], reason: 'says the opposite' }
          : { id: c.id, problem: false, categories: [], reason: '' },
      )

    const first = await run(bare)
    expect(first.problems).toBe(1)
    const before = await loadPo(join(dir, 'plugin-tr-repaired.po'))
    expect(before.auditEntries().map((e) => e.msgid)).toContain('Cancel')

    const adjudicate = vi.fn(bare)
    const second = await run(adjudicate)
    expect(adjudicate).not.toHaveBeenCalled()
    expect(second.problems).toBe(1)

    const after = await loadPo(join(dir, 'plugin-tr-repaired.po'))
    expect(after.auditEntries().map((e) => e.msgid)).toContain('Cancel')
    const text = await readFile(join(dir, 'plugin-tr-repaired.po'), 'utf8')
    expect(text).toMatch(/says the opposite/)
  })

  // Every test above lets its run finish, where `decided` is rebuilt wholesale
  // from the full verdict list regardless of what onCached did. That can pass
  // whether or not onCached exists, so it proves nothing about the mechanism
  // added to stop exactly this: a run interrupted part way through a resume
  // writing a file that has lost what an earlier run already flagged. Only
  // interrupting the resume itself, before it reaches its own first batch's
  // persist, can tell the two apart.
  it('keeps what an earlier run decided in the file, even when the resume itself is interrupted', async () => {
    const flagsBoth: Adjudicator = async (batch) =>
      batch.map((c) => ({ id: c.id, problem: true, categories: ['meaning'], reason: 'says the opposite' }))

    let batches = 0
    await expect(
      reviewFile({
        file: join(dir, 'plugin-tr.po'),
        locale: 'tr',
        db,
        jobsDb,
        adjudicate: flagsBoth,
        mcpConfigPath: '',
        batchSize: 1,
        onProgress: (e) => {
          if (e.type === 'batch-done' && ++batches === 1) throw new Error('interrupted')
        },
      }),
    ).rejects.toThrow('interrupted')

    // "Save" was processed and flagged before the interruption; "Cancel" was
    // not, so this run has one cached verdict and one outstanding candidate.
    await expect(
      reviewFile({
        file: join(dir, 'plugin-tr.po'),
        locale: 'tr',
        db,
        jobsDb,
        adjudicate: flagsBoth,
        mcpConfigPath: '',
        batchSize: 1,
        onProgress: (e) => {
          if (e.type === 'batch-done') throw new Error('interrupted again')
        },
      }),
    ).rejects.toThrow('interrupted again')

    const entries = (await loadPo(join(dir, 'plugin-tr-repaired.po'))).auditEntries().map((e) => e.msgid)
    expect(entries).toContain('Save')
  })

  // finishRun already froze the totals and marked the row 'done' before this
  // event fires. A caller's own progress handler throwing here is not a review
  // that failed part way through, and must not be able to rewrite history into
  // looking like one: a 'stopped' row with real totals is worse than either
  // state alone, because it would read as genuine data to anything that later
  // trusts a run's totals just because its state is terminal.
  it('leaves the run done, with its totals intact, even if the done notification itself throws', async () => {
    await expect(
      reviewFile({
        file: join(dir, 'plugin-tr.po'),
        locale: 'tr',
        db,
        jobsDb,
        adjudicate: clean,
        mcpConfigPath: '',
        onProgress: (e) => {
          if (e.type === 'done') throw new Error('handler blew up')
        },
      }),
    ).rejects.toThrow('handler blew up')

    const row = jobsDb
      .prepare<[], { state: string; entries: number | null; flagged: number | null }>(
        'SELECT state, entries, flagged FROM run ORDER BY id DESC LIMIT 1',
      )
      .get()!
    expect(row.state).toBe('done')
    expect(row.entries).toBe(2)
    expect(row.flagged).toBe(0)
  })
})
