import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceGlossary } from '../../../src/storage/index.js'
import { loadPo } from '../../../src/po/po-file.js'
import { MARKER_HEADER } from '../../../src/audit/resume.js'
import { reviewFile } from '../../../src/commands/review.js'
import { createRunControl } from '../../../src/run-control.js'

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

// Three candidates reach the model, one batch each at this size, so a run can be
// stopped with two entries still untouched.
describe('a review stopped part way', () => {
  let home: string
  let file: string
  let repaired: string
  let db: Database.Database

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'polyglots-pause-'))
    file = join(home, 'plugin-tr.po')
    repaired = join(home, 'plugin-tr-repaired.po')
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

  // Stops the run after its first batch, the way pressing q would.
  function quitAfterFirstBatch() {
    const control = createRunControl()
    const adjudicate = vi.fn(async (batch: { id: number; msgid: string }[]) => {
      control.stop()
      return batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' }))
    })
    return { control, adjudicate }
  }

  function run(overrides = {}) {
    return reviewFile({ file, locale: 'tr', db, batchSize: 1, ...overrides })
  }

  // The whole point. Two entries were never looked at, and calling them
  // approvable would invite the user to bulk-approve work nothing reviewed.
  it('never calls an entry it did not look at approvable', async () => {
    const { control, adjudicate } = quitAfterFirstBatch()
    const summary = await run({ control, adjudicate })

    expect(summary.approvable).toBe(1)
    expect(summary.pending).toBe(2)
  })

  it('reports nothing pending when the run finished', async () => {
    const adjudicate = vi.fn(async (batch: { id: number }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' })),
    )
    const summary = await run({ adjudicate, control: createRunControl() })

    expect(summary.pending).toBe(0)
    // "%s comments" is a placeholder error the rules settle, so it is a problem
    // however the model answers; the other two clear.
    expect(summary.problems).toBe(1)
    expect(summary.approvable).toBe(2)
  })

  it('leaves a marker saying how far it got', async () => {
    const { control, adjudicate } = quitAfterFirstBatch()
    await run({ control, adjudicate })

    const marker = JSON.parse((await loadPo(repaired)).headers[MARKER_HEADER]!)
    expect(marker).toMatchObject({ done: 1, of: 3 })
  })

  // Quitting and coming back later is the feature: the second run must pick up
  // the two it never reached, and not re-spend on the one it already did.
  it('picks up the rest on the next run', async () => {
    const first = quitAfterFirstBatch()
    await run(first)

    const adjudicate = vi.fn(async (batch: { id: number; msgid: string }[]) =>
      batch.map((c) => ({ id: c.id, problem: false, categories: [] as never[], reason: 'ok' })),
    )
    const summary = await run({ adjudicate })

    expect(adjudicate).toHaveBeenCalledTimes(2)
    const seen = adjudicate.mock.calls.flatMap(([batch]) => batch.map((c) => c.msgid))
    expect(seen).toEqual(['%s comments', 'Open the sidebar'])
    expect(summary.pending).toBe(0)
  })

  it('adds up: everything reviewable is flagged, approvable or pending', async () => {
    const { control, adjudicate } = quitAfterFirstBatch()
    const summary = await run({ control, adjudicate })

    expect(summary.problems + summary.needsReview + summary.approvable + summary.pending).toBe(summary.reviewed)
  })
})
