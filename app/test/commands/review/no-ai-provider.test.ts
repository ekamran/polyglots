import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openJobsDb } from '../../../src/jobs/db.js'
import { putAuditVerdict } from '../../../src/jobs/index.js'
import { openDb, replaceGlossary } from '../../../src/storage/index.js'
import { reviewFile } from '../../../src/commands/review.js'
import { saveConfig } from '../../../src/config.js'

// The `none` review choice: a rules-only review without --no-ai. Every test
// here runs with no agent binary reachable and no API key set, so a code path
// that still reached for one would fail its batches and show up as unreviewed
// entries rather than passing quietly.

const PO = `msgid ""
msgstr ""
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"

msgid "Save %s"
msgstr "Kaydet"

msgid "Cancel"
msgstr "İptal"
`

let dir: string
let file: string
let db: Database.Database
let jobsDb: Database.Database
let saved: NodeJS.ProcessEnv

beforeEach(async () => {
  saved = { ...process.env }
  process.env.PATH = ''
  process.env.POLYGLOTS_AGENT_BIN = '/nonexistent/agent'
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
  dir = await mkdtemp(join(tmpdir(), 'polyglots-review-none-'))
  file = join(dir, 'plugin-tr.po')
  await writeFile(file, PO)
  db = openDb(join(dir, 'polyglots.db'))
  jobsDb = openJobsDb(join(dir, 'jobs.db'))
  replaceGlossary(db, 'tr', [{ sourceTerm: 'Settings', translation: 'Ayarlar', locale: 'tr' }])
})

afterEach(async () => {
  db.close()
  jobsDb.close()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  await rm(dir, { recursive: true, force: true })
})

const verdictRows = () => jobsDb.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM audit_verdict').get()!.n

describe('review with reviewProvider none', () => {
  it('runs the rules only when the configured provider is none, without --no-ai', async () => {
    saveConfig({ reviewProvider: 'none' })
    const summary = await reviewFile({ file, locale: 'tr', db, jobsDb })
    expect(summary.unreviewed).toBe(0)
    expect(summary.problems).toBeGreaterThan(0)
    // Named for a rules-only run, as --no-ai names it.
    expect(summary.problemsFile).toBe(join(dir, 'plugin-tr-problems.po'))
    expect(await readdir(dir)).not.toContain('plugin-tr-repaired.po')
    const row = jobsDb.prepare<[], { engine: string; state: string }>('SELECT engine, state FROM run ORDER BY id DESC LIMIT 1').get()!
    expect(row).toEqual({ engine: 'rules', state: 'done' })
  })

  it('takes none as an explicit provider too', async () => {
    const summary = await reviewFile({ file, locale: 'tr', db, jobsDb, provider: 'none' })
    expect(summary.unreviewed).toBe(0)
    expect(summary.problemsFile).toBe(join(dir, 'plugin-tr-problems.po'))
  })

  it('neither writes a verdict nor prunes the verdicts an AI run cached under another configuration', async () => {
    // A verdict an agent formed under an earlier glossary. It is unreachable
    // until that glossary comes back, but a run that judged nothing has no
    // business deleting it.
    putAuditVerdict(
      jobsDb,
      { srcHash: 'x', configHash: 'an-older-glossary', locale: 'tr', engine: 'claude' },
      { problem: false, reason: 'fine', categories: [] },
    )
    await reviewFile({ file, locale: 'tr', db, jobsDb, provider: 'none' })
    expect(verdictRows()).toBe(1)
    await reviewFile({ file, locale: 'tr', db, jobsDb, noAi: true })
    expect(verdictRows()).toBe(1)
  })
})
