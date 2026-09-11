import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceGlossary } from '../../src/storage/index.js'
import { writeMcpConfig } from '../../src/mcp/config.js'
import { loadPo } from '../../src/po/po-file.js'
import { reviewFile } from '../../src/commands/review.js'
import type { ReviewEvent } from '../../src/types.js'

const FAKE_CLAUDE = resolve(import.meta.dirname, '../fixtures/fake-claude/claude')

// A submission with the failure modes a machine-translated contribution really shows.
const SUBMISSION = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Save all changes"
msgstr "Tüm değişiklikleri kaydet"

msgid "Save All Settings"
msgstr "Tüm Ayarları Kaydet"

msgid "%s comments awaiting moderation"
msgstr "yorumlar onay bekliyor"

msgid "Open the sidebar"
msgstr "Yan menüyü aç"

msgid "BAD meaning here"
msgstr "Tamamen farklı bir şey"

msgid "Read <a href=\\"%s\\">the docs</a>"
msgstr "Belgeleri oku"

msgid "Nothing submitted"
msgstr ""
`

describe('review end to end', () => {
  let home: string
  let file: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-review-e2e-'))
    process.env.POLYGLOTS_HOME = home
    file = join(home, 'plugin-tr_TR.po')
    await writeFile(file, SUBMISSION, 'utf8')
    db = openDb(join(home, 'polyglots.db'))
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu', partOfSpeech: 'noun' },
    ])
  })

  afterEach(async () => {
    db.close()
    delete process.env.POLYGLOTS_HOME
    await rm(home, { recursive: true, force: true })
  })

  async function run(overrides = {}) {
    return reviewFile({
      file,
      locale: 'tr',
      db,
      claudeBin: FAKE_CLAUDE,
      mcpConfigPath: await writeMcpConfig({ dir: home }),
      ...overrides,
    })
  }

  it('drives the real claude runner and splits the submission', async () => {
    const summary = await run()

    expect(summary.total).toBe(7)
    expect(summary.skipped).toBe(1)
    expect(summary.reviewed).toBe(6)
    expect(summary.unreviewed).toBe(0)
    expect(summary.problems).toBeGreaterThan(0)
    expect(summary.problems + summary.approvable).toBe(summary.reviewed)
  })

  it('catches the mechanical failures without help from the model', async () => {
    const summary = await run({ noAi: true })
    expect(Object.keys(summary.byRule)).toEqual(expect.arrayContaining(['placeholder', 'html', 'title-case']))
  })

  it('writes a problems file that parses, is fuzzy, and carries its reasons', async () => {
    const summary = await run()
    const problems = await loadPo(summary.problemsFile!)
    const entries = problems.auditEntries()

    expect(entries.length).toBe(summary.problems)
    expect(entries.every((e) => e.fuzzy)).toBe(true)
    expect(entries.every((e) => e.msgstr.some(Boolean))).toBe(true)

    const text = await readFile(summary.problemsFile!, 'utf8')
    expect(text).toContain('polyglots:')
    expect(text).toContain('Plural-Forms: nplurals=2')
  })

  it('hands the problems file to translate as pending work', async () => {
    const summary = await run()
    const problems = await loadPo(summary.problemsFile!)

    // `translate` selects empty-or-fuzzy entries, which is exactly what review wrote.
    expect(problems.units('pending').length).toBe(summary.problems)
  })

  it('lets the model flag a meaning error the rules cannot see', async () => {
    const summary = await run()
    const text = await readFile(summary.problemsFile!, 'utf8')
    expect(summary.byRule['ai:meaning']).toBeGreaterThan(0)
    expect(text).toContain('BAD meaning here')
  })

  it('clears entries the rules only suspected but the model approved', async () => {
    const withAi = await run()
    const rulesOnly = await run({ noAi: true, outDir: join(home, 'rules-only-compare') })

    // Rules alone cannot decide a suspect, so it is reported as needing a human
    // rather than asserted as a problem. The model resolves each one, and fewer
    // survive than the rules raised in total.
    expect(rulesOnly.needsReview).toBeGreaterThan(0)
    expect(withAi.needsReview).toBe(0)
    expect(withAi.problems).toBeLessThan(rulesOnly.problems + rulesOnly.needsReview)
  })

  it('names the categories it found in the summary', async () => {
    const summary = await run()
    expect(Object.keys(summary.byRule)).toEqual(expect.arrayContaining(['ai:meaning']))
    expect(summary.problems).toBeGreaterThan(0)
  })

  it('carries a suspect into the file only when the model did not clear it', async () => {
    const rulesOnly = await run({ noAi: true, outDir: join(home, 'rules-only') })
    const text = await readFile(rulesOnly.problemsFile!, 'utf8')

    expect(text).toContain('Save All Settings')
    expect(text).toMatch(/polyglots:.*title case/i)
  })

  it('flags everything as unreviewed when the model cannot be reached', async () => {
    const summary = await run({ claudeBin: join(home, 'no-such-binary') })
    expect(summary.unreviewed).toBeGreaterThan(0)
    expect(summary.approvable).toBe(0)
  })

  // The real runner, a real interruption, and the real marker: a resumed run has
  // to land on the same answer as one that was never interrupted.
  it('picks a real interrupted run back up and reaches the same verdict', async () => {
    let batches = 0
    await expect(
      run({
        batchSize: 2,
        onProgress: (e: ReviewEvent) => {
          if (e.type === 'batch-done' && ++batches === 1) throw new Error('interrupted')
        },
      }),
    ).rejects.toThrow('interrupted')

    const events: ReviewEvent[] = []
    const resumedRun = await run({ batchSize: 2, onProgress: (e: ReviewEvent) => events.push(e) })
    expect(events[0]).toMatchObject({ type: 'start', resumed: 1 })
    // Only the second batch was re-reviewed.
    expect(events.filter((e) => e.type === 'batch-start')).toHaveLength(1)

    const uninterrupted = await run({ batchSize: 2, fresh: true, outDir: join(home, 'uninterrupted') })
    expect(resumedRun.problems).toBe(uninterrupted.problems)
    expect(resumedRun.approvable).toBe(uninterrupted.approvable)
    expect(resumedRun.byRule).toEqual(uninterrupted.byRule)

    const keysOf = async (path: string) => (await loadPo(path)).auditEntries().map((e) => e.key).sort()
    expect(await keysOf(resumedRun.problemsFile!)).toEqual(await keysOf(uninterrupted.problemsFile!))
  })

  it('leaves the submitted file untouched', async () => {
    const before = await readFile(file, 'utf8')
    await run()
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
