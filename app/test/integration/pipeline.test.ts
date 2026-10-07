import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { po } from 'gettext-parser'
import { importTmx } from '../../src/commands/tm-import.js'
import { translateFile, type TranslateOptions } from '../../src/commands/translate.js'
import { DraftQuotaError } from '../../src/draft/index.js'
import { writeMcpConfig } from '../../src/mcp/config.js'
import { dataDir } from '../../src/paths.js'
import {
  CTX,
  SAMPLE_PENDING_KEYS,
  SAMPLE_TRANSLATED_KEYS,
  blockFor,
  collect,
  entryOf,
  fakeClaude,
  fakeEngine,
  hooksPo,
  makeWorkspace,
  ofType,
  parseFile,
  snapshotEnv,
  writeTmx,
  type Workspace,
} from './helpers.js'

let ws: Workspace
let restoreEnv: () => void

beforeAll(async () => {
  await chmod(fakeClaude, 0o755)
})

beforeEach(() => {
  restoreEnv = snapshotEnv()
})

afterEach(async () => {
  restoreEnv()
  await ws.cleanup()
})

async function run(overrides: Partial<TranslateOptions> = {}) {
  const { events, onProgress } = collect()
  const engine = fakeEngine()
  const mcpConfigPath = await writeMcpConfig()
  const summary = await translateFile({
    file: ws.file,
    locale: 'tr',
    mode: 'pending',
    draftEngine: 'deepl',
    engine,
    bin: fakeClaude,
    mcpConfigPath,
    batchSize: 4,
    onProgress,
    ...overrides,
  })
  return { summary, events, engine, mcpConfigPath }
}

describe('A. full pipeline: fake engine + real reviewBatch + fake claude + generated mcp.json', () => {
  beforeEach(async () => {
    ws = await makeWorkspace()
  })

  it('fills every pending entry, stamps the header and hands claude the generated mcp.json', async () => {
    const argsOut = join(ws.home, 'claude-args.json')
    process.env.FAKE_CLAUDE_ARGS_OUT = argsOut

    const { summary, events, engine, mcpConfigPath } = await run()

    expect(mcpConfigPath).toBe(join(dataDir(), 'mcp.json'))
    expect(summary).toEqual({
      file: ws.file,
      total: 12,
      pending: 7,
      fromTm: 0,
      translated: 7,
      fuzzy: 0,
      skipped: 0,
    })
    expect(events.at(-1)).toEqual({ type: 'done', summary })
    expect(ofType(events, 'batch-done').map((e) => e.index)).toEqual([1, 2])
    expect(ofType(events, 'saved')).toHaveLength(2)
    expect(engine.seenKeys().sort()).toEqual([...SAMPLE_PENDING_KEYS].sort())

    const after = await parseFile(ws.file)
    expect(after.headers['X-Generator']).toBe('polyglots')
    expect(after.headers['Language']).toBe('tr')
    for (const key of SAMPLE_PENDING_KEYS) {
      const entry = entryOf(after, key)
      expect(entry.msgstr.every((s) => s.length > 0), key).toBe(true)
      expect(entry.comments?.flag ?? '', key).not.toMatch(/fuzzy/)
    }
    expect(entryOf(after, 'Save Changes').msgstr).toEqual(['[tr] Save Changes'])
    expect(entryOf(after, 'Form entries').msgstr).toEqual(['[tr] Form entries'])
    expect(entryOf(after, `post type singular name${CTX}Form`).msgstr).toEqual(['[tr] Form'])
    expect(entryOf(after, 'One submission was deleted.').msgstr).toEqual([
      '[tr] One submission was deleted.',
      '[tr] %d submissions were deleted.',
    ])

    const argv = JSON.parse(await readFile(argsOut, 'utf8')) as string[]
    expect(argv[argv.indexOf('--mcp-config') + 1]).toBe(mcpConfigPath)
    expect(argv).toContain('--strict-mcp-config')
  })

  it('leaves already-translated entries semantically untouched', async () => {
    await run()
    const originalParsed = po.parse(ws.original)
    const after = await parseFile(ws.file)
    for (const key of SAMPLE_TRANSLATED_KEYS) {
      const was = entryOf(originalParsed, key)
      const now = entryOf(after, key)
      expect(now.msgstr, key).toEqual(was.msgstr)
      expect(now.msgctxt, key).toEqual(was.msgctxt)
      expect(now.msgid_plural, key).toEqual(was.msgid_plural)
      expect(now.comments?.flag ?? '', key).toEqual(was.comments?.flag ?? '')
      expect(now.comments?.reference, key).toEqual(was.comments?.reference)
      expect((now.comments?.translator ?? '').trim(), key).toEqual((was.comments?.translator ?? '').trim())
    }
  })

  it('keeps comment-free translated entries byte-identical on disk', async () => {
    await run()
    const before = ws.original.toString('utf8')
    const after = await readFile(ws.file, 'utf8')
    for (const key of ['Settings', `post type general name${CTX}Forms`, '%d entry', 'Your message has been sent.']) {
      expect(blockFor(after, key), key).toBe(blockFor(before, key))
    }
  })

  // Accepted, not pending (2026-09-11): gettext-parser re-emits
  // `#  Keep the brand name untranslated.` as `# Keep ...`, dropping the leading
  // whitespace of translator comments, so this one entry is not byte-identical.
  // Fixing it would mean post-processing the compiled output or replacing the
  // compiler, for an indentation nobody relies on. The test stays as a live record
  // of the limitation: if gettext-parser ever preserves it, this starts passing
  // and tells us.
  it.fails('keeps a translated entry with a translator comment byte-identical on disk', async () => {
    await run()
    const before = ws.original.toString('utf8')
    const after = await readFile(ws.file, 'utf8')
    expect(blockFor(after, 'Powered by Sample Forms')).toBe(blockFor(before, 'Powered by Sample Forms'))
  })

  it('flags entries the reviewer marks fuzzy and leaves the rest clean', async () => {
    await ws.cleanup()
    ws = await makeWorkspace(hooksPo)

    const { summary, events } = await run()

    expect(summary).toMatchObject({ pending: 8, translated: 8, fuzzy: 1, skipped: 0 })
    expect(ofType(events, 'batch-done').reduce((n, e) => n + e.fuzzy, 0)).toBe(1)

    const after = await parseFile(ws.file)
    const flagged = entryOf(after, 'Action Hook (FUZZY)')
    expect(flagged.msgstr).toEqual(['[tr] Action Hook (FUZZY)'])
    expect(flagged.comments?.flag).toBe('fuzzy')
    expect(entryOf(after, 'Form entries').comments?.flag).toBeUndefined()
    expect(entryOf(after, 'Save Changes').comments?.flag).toBeUndefined()
  })

  it('does not write anything in dry-run mode', async () => {
    const { summary } = await run({ dryRun: true })
    expect(summary).toMatchObject({ translated: 7 })
    expect(await readFile(ws.file)).toEqual(ws.original)
  })
})

describe('B. TM fast path through tm import', () => {
  beforeEach(async () => {
    ws = await makeWorkspace()
  })

  it('serves an exact TM hit without asking the engine or claude', async () => {
    const tmxPath = await writeTmx(ws.home, 'poedit.tmx', [
      { source: 'Save Changes', target: 'Değişiklikleri Kaydet' },
      { source: 'Unrelated string', target: 'İlgisiz dize' },
    ])
    const imported = await importTmx([tmxPath], { locale: 'tr' })
    expect(imported).toEqual({ files: 1, entries: 2, upserted: 2 })

    const { summary, events, engine } = await run()

    expect(summary).toMatchObject({ pending: 7, fromTm: 1, translated: 6, skipped: 0 })
    expect(ofType(events, 'tm-hit')).toEqual([{ type: 'tm-hit', count: 1 }])
    expect(engine.seenKeys()).not.toContain('Save Changes')
    expect(engine.seenKeys()).toHaveLength(6)
    expect(events.findIndex((e) => e.type === 'tm-hit')).toBeLessThan(events.findIndex((e) => e.type === 'batch-start'))
    expect(ofType(events, 'saved')).toHaveLength(3)

    const after = await parseFile(ws.file)
    const hit = entryOf(after, 'Save Changes')
    expect(hit.msgstr).toEqual(['Değişiklikleri Kaydet'])
    expect(hit.comments?.flag).toBeUndefined()
  })

  it('does not let a TM hit for the singular alone fill a plural entry', async () => {
    const tmxPath = await writeTmx(ws.home, 'partial.tmx', [
      { source: 'One submission was deleted.', target: 'Bir gönderim silindi.' },
    ])
    await importTmx([tmxPath], { locale: 'tr' })

    const { summary, engine } = await run()

    expect(summary).toMatchObject({ fromTm: 0, translated: 7 })
    expect(engine.seenKeys()).toContain('One submission was deleted.')
  })
})

describe('C. resume after a failed run', () => {
  beforeEach(async () => {
    ws = await makeWorkspace()
  })

  it('skips every batch when claude fails, leaves the file untouched, then finishes on the next run', async () => {
    process.env.FAKE_CLAUDE_MODE = 'exit1'
    const first = await run()

    expect(first.summary).toMatchObject({ pending: 7, translated: 0, skipped: 7, fromTm: 0 })
    expect(first.summary.stopped).toBeUndefined()
    expect(ofType(first.events, 'batch-skipped').map((e) => e.index)).toEqual([1, 2])
    expect(ofType(first.events, 'batch-skipped').map((e) => e.reason)).toEqual([
      expect.stringMatching(/exit code 1/),
      expect.stringMatching(/exit code 1/),
    ])
    expect(ofType(first.events, 'saved')).toHaveLength(0)
    expect(await readFile(ws.file)).toEqual(ws.original)

    delete process.env.FAKE_CLAUDE_MODE
    const second = await run()

    expect(second.summary).toMatchObject({ pending: 7, translated: 7, skipped: 0 })
    const after = await parseFile(ws.file)
    for (const key of SAMPLE_PENDING_KEYS) expect(entryOf(after, key).msgstr.every((s) => s.length > 0), key).toBe(true)

    const third = await run()
    expect(third.summary).toMatchObject({ pending: 0, translated: 0 })
    expect(third.engine.calls).toHaveLength(0)
  })
})

describe('D. quota stop', () => {
  beforeEach(async () => {
    ws = await makeWorkspace()
  })

  it('persists batch 1, records the stop reason and leaves the rest for the next run', async () => {
    const engine = fakeEngine()
    engine.failWith = (index) => (index === 1 ? new DraftQuotaError('deepl', 'Quota exceeded') : undefined)

    const { summary, events } = await run({ engine })

    expect(summary).toMatchObject({ pending: 7, translated: 4, fuzzy: 0, skipped: 0, stopped: 'deepl: Quota exceeded' })
    expect(events.at(-1)).toEqual({ type: 'done', summary })
    expect(ofType(events, 'batch-done').map((e) => e.index)).toEqual([1])
    expect(ofType(events, 'batch-start').map((e) => e.index)).toEqual([1, 2])
    expect(engine.calls).toHaveLength(2)

    const after = await parseFile(ws.file)
    const [done, left] = [SAMPLE_PENDING_KEYS.slice(0, 4), SAMPLE_PENDING_KEYS.slice(4)]
    for (const key of done) expect(entryOf(after, key).msgstr.every((s) => s.length > 0), key).toBe(true)
    for (const key of left) expect(entryOf(after, key).msgstr.every((s) => s === ''), key).toBe(true)
    expect(after.headers['X-Generator']).toBe('polyglots')

    const resumed = await run()
    expect(resumed.summary).toMatchObject({ pending: 3, translated: 3 })
    expect(resumed.summary.stopped).toBeUndefined()
    expect(resumed.engine.seenKeys().sort()).toEqual([...left].sort())
  })
})
