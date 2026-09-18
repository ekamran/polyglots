import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../../../src/storage/index.js'
import { translateFile } from '../../../src/commands/translate.js'

// translate opens two databases. polyglots.db holds the translation memory,
// months of TMX imports; jobs.db holds disposable run state. The second open
// can throw, and the first handle is the one that must not be left behind: in
// the long-lived TUI it outlives the command.
vi.mock('../../../src/storage/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/index.js')>()
  return { ...actual, openDb: vi.fn(actual.openDb) }
})

vi.mock('../../../src/jobs/db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/jobs/db.js')>()
  return {
    ...actual,
    openJobsDb: vi.fn(() => {
      throw new Error('jobs.db is unopenable')
    }),
  }
})

const PO = `msgid ""
msgstr ""
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n > 1;\\n"

msgid "Save"
msgstr ""
`

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-handles-'))
  await writeFile(join(dir, 'plugin-tr.po'), PO)
  vi.mocked(openDb).mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('translate when the job store cannot be opened', () => {
  it('closes the translation memory it had already opened', async () => {
    await expect(
      translateFile({
        file: join(dir, 'plugin-tr.po'),
        locale: 'tr',
        mode: 'pending',
        draftEngine: 'deepl',
        mcpConfigPath: '',
      }),
    ).rejects.toThrow('jobs.db is unopenable')

    const opened = vi.mocked(openDb).mock.results.map((r) => r.value as Database.Database)
    expect(opened).toHaveLength(1)
    expect(opened[0]!.open).toBe(false)
  })
})
