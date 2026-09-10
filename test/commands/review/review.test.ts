import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceGlossary } from '../../../src/storage/index.js'
import { loadPo } from '../../../src/po/po-file.js'
import { reviewFile } from '../../../src/commands/review.js'
import type { ReviewEvent } from '../../../src/types.js'

const PO = `msgid ""
msgstr ""
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Save all changes"
msgstr "Tüm değişiklikleri kaydet"

msgid "%s comments"
msgstr "yorumlar"

msgid "Open the sidebar"
msgstr "Yan menüyü aç"

msgid "Never submitted"
msgstr ""
`

describe('reviewFile', () => {
  let home: string
  let file: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-review-'))
    file = join(home, 'plugin-tr.po')
    await writeFile(file, PO, 'utf8')
    db = openDb(join(home, 'polyglots.db'))
    replaceGlossary(db, 'tr', [
      { locale: 'tr', sourceTerm: 'sidebar', translation: 'kenar çubuğu', partOfSpeech: 'noun' },
    ])
  })

  afterEach(async () => {
    db.close()
    await rm(home, { recursive: true, force: true })
  })

  const clearAll = vi.fn(async (batch: { id: number }[]) =>
    batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' })),
  )

  function run(overrides = {}) {
    return reviewFile({ file, locale: 'tr', db, adjudicate: clearAll, ...overrides })
  }

  it('derives both output names from the input file', async () => {
    const summary = await run()
    expect(summary.problemsFile).toBe(join(home, 'plugin-tr-problems.po'))
    expect(summary.reportFile).toBe(join(home, 'plugin-tr-report.md'))
  })

  it('honours outDir while keeping the derived names', async () => {
    const outDir = join(home, 'out')
    const summary = await run({ outDir })
    expect(summary.problemsFile).toBe(join(outDir, 'plugin-tr-problems.po'))
    expect(summary.reportFile).toBe(join(outDir, 'plugin-tr-report.md'))
    expect(await readdir(outDir)).toContain('plugin-tr-problems.po')
  })

  it('skips entries with nothing submitted and counts them', async () => {
    const summary = await run()
    expect(summary.total).toBe(4)
    expect(summary.skipped).toBe(1)
    expect(summary.reviewed).toBe(3)
  })

  it('writes only flagged entries, marked fuzzy with their reasons', async () => {
    const summary = await run()
    const problems = await loadPo(summary.problemsFile!)
    const entries = problems.auditEntries()

    expect(entries.map((e) => e.msgid)).toEqual(['%s comments'])
    expect(entries[0]!.fuzzy).toBe(true)
    expect(entries[0]!.msgstr).toEqual(['yorumlar'])
    const text = await readFile(summary.problemsFile!, 'utf8')
    expect(text).toContain('polyglots:')
    expect(text).toMatch(/placeholder/i)
  })

  it('counts approvable entries as the reviewed ones it did not flag', async () => {
    const summary = await run()
    expect(summary.problems).toBe(1)
    expect(summary.approvable).toBe(2)
  })

  it('groups the report by rule', async () => {
    const summary = await run()
    expect(summary.byRule).toMatchObject({ placeholder: 1 })
    const report = await readFile(summary.reportFile, 'utf8')
    expect(report).toContain('placeholder')
    expect(report).toContain('%s comments')
  })

  it('writes no po file when nothing is flagged, but still writes the report', async () => {
    await writeFile(file, PO.replace('msgstr "yorumlar"', 'msgstr "%s yorum"'), 'utf8')
    const summary = await run()

    expect(summary.problems).toBe(0)
    expect(summary.problemsFile).toBeUndefined()
    expect(await readdir(home)).not.toContain('plugin-tr-problems.po')
    expect(await readFile(summary.reportFile, 'utf8')).toMatch(/nothing/i)
  })

  it('flags what the AI reports as a problem', async () => {
    const adjudicate = vi.fn(async (batch: { id: number; msgid: string }[]) =>
      batch.map((c) => ({
        id: c.id,
        problem: c.msgid === 'Save all changes',
        categories: c.msgid === 'Save all changes' ? (['meaning'] as never[]) : ([] as never[]),
        reason: 'says the opposite',
      })),
    )
    const summary = await run({ adjudicate })

    expect(summary.problems).toBe(2)
    expect(summary.byRule).toMatchObject({ 'ai:meaning': 1, placeholder: 1 })
  })

  it('never sends the AI an entry a hard rule already condemned', async () => {
    const adjudicate = vi.fn(async (batch: { id: number; msgid: string }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' })),
    )
    await run({ adjudicate })
    const seen = adjudicate.mock.calls.flatMap(([batch]) => batch.map((c) => c.msgid))
    expect(seen).not.toContain('%s comments')
  })

  it('skips the AI entirely with noAi', async () => {
    const adjudicate = vi.fn()
    const summary = await run({ noAi: true, adjudicate })
    expect(adjudicate).not.toHaveBeenCalled()
    expect(summary.problems).toBeGreaterThan(0)
  })

  it('counts entries whose review failed as unreviewed problems', async () => {
    const adjudicate = vi.fn().mockRejectedValue(new Error('claude exited with exit code 1'))
    const summary = await run({ adjudicate })
    expect(summary.unreviewed).toBe(2)
    expect(summary.problems).toBe(3)
  })

  it('emits progress ending in done', async () => {
    const events: ReviewEvent[] = []
    const summary = await run({ onProgress: (e: ReviewEvent) => events.push(e) })

    expect(events[0]).toMatchObject({ type: 'start', total: 4, reviewable: 3 })
    expect(events.at(-1)).toEqual({ type: 'done', summary })
    expect(events.some((e) => e.type === 'written')).toBe(true)
  })

  // Run with noAi so rule findings land in the summary directly; with the model in
  // the loop a cleared suspect would make this pass whether or not it was wired.
  it('passes configured proper nouns to the rules so a name is not flagged', async () => {
    await writeFile(
      file,
      PO.replace('msgstr "Yan menüyü aç"', 'msgstr "Türk Dil Kurumu tarafından onaylandı"'),
      'utf8',
    )

    const without = await run({ noAi: true, outDir: join(home, 'a') })
    expect(without.byRule['title-case']).toBe(1)

    const withNames = await run({ noAi: true, outDir: join(home, 'b'), properNouns: ['Türk Dil Kurumu'] })
    expect(withNames.byRule['title-case']).toBeUndefined()
  })

  it('fails with a sync hint when the locale has no cached glossary', async () => {
    await expect(run({ locale: 'de' })).rejects.toThrow(/glossary sync/)
  })

  it('leaves the reviewed file untouched', async () => {
    const before = await readFile(file, 'utf8')
    await run()
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
