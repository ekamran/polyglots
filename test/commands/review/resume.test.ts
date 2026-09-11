import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceGlossary } from '../../../src/storage/index.js'
import { loadPo } from '../../../src/po/po-file.js'
import { decodeMarker, MARKER_HEADER } from '../../../src/audit/resume.js'
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

// Two candidates reach the model: "%s comments" is a placeholder error the rules
// settle on their own, and "Never submitted" is not submitted at all. At a batch
// size of one that is two batches, so a run can be cut off between them.
describe('resuming an interrupted review', () => {
  let home: string
  let file: string
  let problems: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-resume-'))
    file = join(home, 'plugin-tr.po')
    problems = join(home, 'plugin-tr-problems.po')
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

  const clears = () =>
    vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' })),
    )

  const flags = () =>
    vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: true, categories: ['meaning'] as never[], reason: 'says the opposite' })),
    )

  function run(overrides = {}) {
    return reviewFile({ file, locale: 'tr', db, batchSize: 1, adjudicate: clears(), ...overrides })
  }

  // Kills the run the way a Ctrl+C would: after the first batch is decided and
  // written, before the second one starts.
  async function interrupt(overrides = {}): Promise<void> {
    let batches = 0
    await expect(
      run({
        adjudicate: flags(),
        onProgress: (e: ReviewEvent) => {
          if (e.type === 'batch-done' && ++batches === 1) throw new Error('interrupted')
        },
        ...overrides,
      }),
    ).rejects.toThrow('interrupted')
  }

  it('records how far it got in the problems file header', async () => {
    await run()
    const marker = decodeMarker((await loadPo(problems)).headers[MARKER_HEADER])
    expect(marker).toMatchObject({ done: 2, of: 2 })
  })

  it('does not re-review the batches the interrupted run finished', async () => {
    await interrupt()
    const adjudicate = clears()
    await run({ adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(1)
    const seen = adjudicate.mock.calls.flatMap(([batch]) => (batch as { msgid: string }[]).map((c) => c.msgid))
    expect(seen).toEqual(['Open the sidebar'])
  })

  it('keeps the entries the interrupted run had already flagged', async () => {
    await interrupt()
    await run()

    const kept = (await loadPo(problems)).auditEntries().map((e) => e.msgid)
    expect(kept).toContain('Save all changes')
    expect(await readFile(problems, 'utf8')).toContain('says the opposite')
  })

  it('counts the skipped batches in the summary, not just the ones it ran', async () => {
    await interrupt()
    const summary = await run()

    // The placeholder error from the rules, plus the one the first run flagged.
    expect(summary.problems).toBe(2)
    expect(summary.approvable).toBe(1)
    expect(summary.byRule).toMatchObject({ 'ai:meaning': 1, placeholder: 1 })
  })

  it('says how many batches it is skipping when it starts', async () => {
    await interrupt()
    const events: ReviewEvent[] = []
    await run({ onProgress: (e: ReviewEvent) => events.push(e) })

    expect(events[0]).toMatchObject({ type: 'start', resumed: 1 })
  })

  it('refuses to resume onto a submission that has changed since', async () => {
    await interrupt()
    await writeFile(file, PO.replace('Yan menüyü aç', 'Kenar çubuğunu aç'), 'utf8')

    await expect(run()).rejects.toThrow(/submission file has changed/)
  })

  it('names --fresh when it refuses, so the message says what to do', async () => {
    await interrupt()
    await writeFile(file, PO.replace('Yan menüyü aç', 'Kenar çubuğunu aç'), 'utf8')

    await expect(run()).rejects.toThrow(/--fresh/)
  })

  it('refuses to resume across a change of batch size', async () => {
    await interrupt()
    await expect(run({ batchSize: 2 })).rejects.toThrow(/batch size has changed/)
  })

  it('starts over when asked for a fresh run', async () => {
    await interrupt()
    const adjudicate = clears()
    await run({ adjudicate, fresh: true })

    expect(adjudicate).toHaveBeenCalledTimes(2)
  })

  it('re-runs a review that had already finished rather than doing nothing', async () => {
    await run()
    const adjudicate = clears()
    await run({ adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(2)
  })

  // Without this there is nothing to resume from until the first entry is
  // flagged, which on a clean submission could be hours in.
  it('leaves a marker after the first batch even when nothing is flagged yet', async () => {
    await writeFile(file, PO.replace('msgstr "yorumlar"', 'msgstr "%s yorum"'), 'utf8')
    const seen: (number | undefined)[] = []
    const adjudicate = vi.fn(async (batch: { id: number }[]) => {
      const marker = await loadPo(problems).then((p) => decodeMarker(p.headers[MARKER_HEADER])).catch(() => undefined)
      seen.push(marker?.done)
      return batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' }))
    })

    await run({ adjudicate })
    expect(seen).toEqual([undefined, 1, 2])
  })

  it('takes the marker file away again when the finished run flagged nothing', async () => {
    await writeFile(file, PO.replace('msgstr "yorumlar"', 'msgstr "%s yorum"'), 'utf8')
    const summary = await run()

    expect(summary.problems).toBe(0)
    expect(summary.problemsFile).toBeUndefined()
    expect(await readdir(home)).not.toContain('plugin-tr-problems.po')
  })

  it('does not announce a file that holds nothing but a marker', async () => {
    await writeFile(file, PO.replace('msgstr "yorumlar"', 'msgstr "%s yorum"'), 'utf8')
    const events: ReviewEvent[] = []
    await run({ onProgress: (e: ReviewEvent) => events.push(e) })

    expect(events.some((e) => e.type === 'written')).toBe(false)
  })
})
