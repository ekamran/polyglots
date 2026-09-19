import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { main, type CliDeps } from '../../src/cli.js'
import type { TranslateOptions, TranslateSummary } from '../../src/commands/translate.js'

const samplePo = fileURLToPath(new URL('../fixtures/po/sample.po', import.meta.url))
const pkg = createRequire(import.meta.url)('../../package.json') as { version: string }

interface Sink {
  isTTY?: boolean
  text: string
  write(chunk: string): boolean
}

function sink(isTTY = false): Sink {
  return {
    isTTY,
    text: '',
    write(chunk: string) {
      this.text += chunk
      return true
    },
  }
}

type FakeStdin = PassThrough & { isTTY?: boolean }

function stdinWith(input: string | undefined, isTTY: boolean): FakeStdin {
  const stream = new PassThrough() as FakeStdin
  stream.isTTY = isTTY
  if (input !== undefined) stream.write(input)
  stream.end()
  return stream
}

interface FakeTranslate {
  fn: (opts: TranslateOptions) => Promise<TranslateSummary>
  calls: TranslateOptions[]
}

function summaryFor(opts: TranslateOptions, patch: Partial<TranslateSummary> = {}): TranslateSummary {
  return { file: opts.file, total: 12, pending: 7, fromTm: 1, translated: 6, fuzzy: 1, skipped: 0, ...patch }
}

function fakeTranslate(plan: (opts: TranslateOptions, call: number) => Partial<TranslateSummary> | Error = () => ({})): FakeTranslate {
  const calls: TranslateOptions[] = []
  return {
    calls,
    async fn(opts) {
      calls.push(opts)
      const emit = opts.onProgress ?? (() => undefined)
      emit({ type: 'start', file: opts.file, total: 12, pending: 7 })
      const outcome = plan(opts, calls.length)
      if (outcome instanceof Error) throw outcome
      const summary = summaryFor(opts, outcome)
      emit({ type: 'tm-hit', count: summary.fromTm })
      emit({ type: 'batch-start', index: 1, of: 1, size: 6, at: Date.now() })
      emit({ type: 'batch-done', index: 1, translated: summary.translated, fuzzy: summary.fuzzy, at: Date.now() })
      emit({ type: 'done', summary })
      return summary
    },
  }
}

interface Harness {
  stdout: Sink
  stderr: Sink
  run(argv: string[], deps?: Omit<CliDeps, 'streams'> & { stdin?: FakeStdin; tty?: boolean }): Promise<number>
}

function harness(): Harness {
  const stdout = sink()
  const stderr = sink()
  return {
    stdout,
    stderr,
    run(argv, deps = {}) {
      const { stdin, tty, ...rest } = deps
      stderr.isTTY = tty === true
      return main(argv, { ...rest, streams: { stdin: stdin ?? stdinWith(undefined, false), stdout, stderr } })
    },
  }
}

let home: string
let file: string
let savedEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  savedEnv = { ...process.env }
  home = await mkdtemp(join(tmpdir(), 'polyglots-cli-main-'))
  file = join(home, 'sample.po')
  await copyFile(samplePo, file)
  process.env.POLYGLOTS_HOME = home
  process.env.DEEPL_API_KEY = 'dpl-test-key-0123456789:fx'
  delete process.env.OPENAI_API_KEY
})

afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  await rm(home, { recursive: true, force: true })
})

describe('translate summary output', () => {
  it('prints the contract summary line on stdout and exits 0', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file], { translate: translate.fn })
    expect(code).toBe(0)
    expect(h.stdout.text).toBe(`Done. 6 translated, 1 fuzzy, 1 from TM, 0 skipped. Open ${file} in PoEdit to review.\n`)
    expect(h.stderr.text).toContain('▰▰▰▰▰▰▰▰▰▰ 7/7  batch 1/1  fuzzy 1')
  })

  it('passes flags and config defaults through to translateFile', async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ batchSize: 4, defaultLocale: 'de' }))
    const h = harness()
    const translate = fakeTranslate()
    await h.run(['translate', file], { translate: translate.fn })
    expect(translate.calls[0]).toMatchObject({ file, locale: 'de', mode: 'pending', draftEngine: 'deepl', batchSize: 4, dryRun: false })
    expect(translate.calls[0]?.secrets?.DEEPL_API_KEY).toBe('dpl-test-key-0123456789:fx')

    translate.calls.length = 0
    process.env.OPENAI_API_KEY = 'sk-test-key-0123456789'
    await h.run(['translate', file, '--locale', 'TR', '--batch-size', '2', '--draft-engine', 'openai', '--model', 'opus'], {
      translate: translate.fn,
    })
    expect(translate.calls[0]).toMatchObject({ locale: 'tr', batchSize: 2, draftEngine: 'openai', model: 'opus' })
  })

  it('uses dry-run wording and never claims a write', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--dry-run'], { translate: translate.fn })
    expect(code).toBe(0)
    expect(translate.calls[0]?.dryRun).toBe(true)
    expect(h.stdout.text).toBe('Dry run. 6 translated, 1 fuzzy, 1 from TM, 0 skipped. Nothing was written.\n')
    expect(h.stdout.text).not.toContain('PoEdit')
  })

  // --mode all exists to translate an entry again. Without a word for it, a
  // cached draft was replayed forever and a user re-running after a bad batch
  // had no recourse short of deleting jobs.db.
  it('forwards --fresh so a cached draft can be refused', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--fresh'], { translate: translate.fn })
    expect(code).toBe(0)
    expect(translate.calls[0]).toMatchObject({ fresh: true })
  })

  it('processes several files in order and prints one summary per file', async () => {
    const second = join(home, 'second.po')
    await copyFile(samplePo, second)
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, second], { translate: translate.fn })
    expect(code).toBe(0)
    expect(translate.calls.map((c) => c.file)).toEqual([file, second])
    const lines = h.stdout.text.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(`Open ${file} in PoEdit`)
    expect(lines[1]).toContain(`Open ${second} in PoEdit`)
  })

  it('reports a file that throws, continues with the next file and exits 1 at the end', async () => {
    const second = join(home, 'second.po')
    await copyFile(samplePo, second)
    const h = harness()
    const translate = fakeTranslate((_opts, call) => (call === 1 ? new Error('bad po syntax') : {}))
    const code = await h.run(['translate', file, second], { translate: translate.fn })
    expect(code).toBe(1)
    expect(translate.calls.map((c) => c.file)).toEqual([file, second])
    expect(h.stderr.text).toContain(`Error: ${file}: bad po syntax`)
    const lines = h.stdout.text.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`Open ${second} in PoEdit`)
  })

  it('exits 3 with a Stopped summary on a quota stop and does not touch later files', async () => {
    const second = join(home, 'second.po')
    await copyFile(samplePo, second)
    const h = harness()
    const translate = fakeTranslate(() => ({ translated: 2, fuzzy: 0, stopped: 'DeepL quota exceeded' }))
    const code = await h.run(['translate', file, second], { translate: translate.fn })
    expect(code).toBe(3)
    expect(translate.calls).toHaveLength(1)
    expect(h.stdout.text).not.toContain('Done.')
    expect(h.stdout.text).toMatch(/^Stopped\. 2 translated, 0 fuzzy, 1 from TM, 0 skipped\./)
    expect(h.stderr.text).toContain('Stopped: DeepL quota exceeded')
  })
})

describe('translate --all confirmation', () => {
  it('asks on a TTY, counts already-translated entries and continues on "y"', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all'], { translate: translate.fn, stdin: stdinWith('y\n', true), tty: true })
    expect(code).toBe(0)
    expect(h.stderr.text).toContain('This will re-translate 5 already-translated entries. Continue? [y/N]')
    expect(translate.calls[0]?.mode).toBe('all')
  })

  it('aborts with exit 1 on "n" without calling translateFile', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all'], { translate: translate.fn, stdin: stdinWith('n\n', true), tty: true })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('Aborted.')
    expect(translate.calls).toHaveLength(0)
    expect(h.stdout.text).toBe('')
  })

  it('treats a closed prompt (Ctrl-D) as "no" instead of hanging', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all'], { translate: translate.fn, stdin: stdinWith(undefined, true), tty: true })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('Aborted.')
    expect(translate.calls).toHaveLength(0)
  })

  it('skips the prompt with --yes', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all', '--yes'], { translate: translate.fn, stdin: stdinWith(undefined, true), tty: true })
    expect(code).toBe(0)
    expect(h.stderr.text).not.toContain('Continue?')
    expect(translate.calls[0]?.mode).toBe('all')
  })

  it('skips the prompt for --all --dry-run because nothing is written', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all', '--dry-run'], { translate: translate.fn, stdin: stdinWith(undefined, false) })
    expect(code).toBe(0)
    expect(h.stderr.text).not.toContain('Continue?')
    expect(h.stderr.text).not.toContain('--all requires --yes')
    expect(translate.calls[0]).toMatchObject({ mode: 'all', dryRun: true })
  })

  it('requires --yes when stderr is redirected even though stdin is a TTY', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all'], { translate: translate.fn, stdin: stdinWith('y\n', true), tty: false })
    expect(code).toBe(2)
    expect(h.stderr.text).toMatch(/--all requires --yes/)
    expect(h.stderr.text).not.toContain('Continue?')
    expect(translate.calls).toHaveLength(0)
  })
})

describe('glossary sync', () => {
  interface FakeSync {
    fn: CliDeps['syncGlossary'] & object
    calls: Array<{ locale: string }>
  }

  function fakeSync(outcome: { entries: number } | Error = { entries: 42 }): FakeSync {
    const calls: Array<{ locale: string }> = []
    return {
      calls,
      async fn(opts) {
        calls.push({ locale: opts.locale })
        if (outcome instanceof Error) throw outcome
        return outcome
      },
    }
  }

  it('uses the config default locale and prints the synced count', async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ defaultLocale: 'de' }))
    const h = harness()
    const sync = fakeSync({ entries: 42 })
    const code = await h.run(['glossary', 'sync'], { syncGlossary: sync.fn })
    expect(code).toBe(0)
    expect(sync.calls).toEqual([{ locale: 'de' }])
    expect(h.stdout.text).toBe('Synced 42 glossary entries for de.\n')
  })

  it('passes a normalized --locale override through', async () => {
    const h = harness()
    const sync = fakeSync({ entries: 3 })
    const code = await h.run(['glossary', 'sync', '--locale', 'PT-BR'], { syncGlossary: sync.fn })
    expect(code).toBe(0)
    expect(sync.calls).toEqual([{ locale: 'pt-br' }])
    expect(h.stdout.text).toBe('Synced 3 glossary entries for pt-br.\n')
  })

  it('exits 1 with the error message when the sync throws', async () => {
    const h = harness()
    const sync = fakeSync(new Error('No glossary entries found for locale "tr"; existing cache left untouched'))
    const code = await h.run(['glossary', 'sync'], { syncGlossary: sync.fn })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('Error: No glossary entries found for locale "tr"')
    expect(h.stdout.text).toBe('')
  })
})

describe('config add-name', () => {
  async function configJson() {
    return JSON.parse(await readFile(join(home, 'config', 'config.json'), 'utf8'))
  }

  it('adds a name under the default locale', async () => {
    const h = harness()
    const code = await h.run(['config', 'add-name', 'Türk Dil Kurumu'])
    expect(code).toBe(0)
    expect((await configJson()).properNouns).toEqual({ tr: ['Türk Dil Kurumu'] })
    expect(h.stdout.text).toContain('Türk Dil Kurumu')
  })

  it('does not duplicate a name already present', async () => {
    const h = harness()
    await h.run(['config', 'add-name', 'İzmir'])
    const code = await h.run(['config', 'add-name', 'İzmir'])
    expect(code).toBe(0)
    expect((await configJson()).properNouns.tr).toEqual(['İzmir'])
  })

  it('honours --locale and keeps other locales intact', async () => {
    const h = harness()
    await h.run(['config', 'add-name', 'İzmir'])
    const code = await h.run(['config', 'add-name', 'Berlin', '--locale', 'de'])
    expect(code).toBe(0)
    expect((await configJson()).properNouns).toEqual({ tr: ['İzmir'], de: ['Berlin'] })
  })

  it('rejects an empty name', async () => {
    const h = harness()
    const code = await h.run(['config', 'add-name', '   '])
    expect(code).toBe(2)
  })

  it('lists configured names in config get', async () => {
    const h = harness()
    await h.run(['config', 'add-name', 'Türk Dil Kurumu'])
    await h.run(['config', 'get'])
    expect(h.stdout.text).toContain('properNouns')
    expect(h.stdout.text).toContain('tr: Türk Dil Kurumu')
    expect(h.stdout.text).not.toContain('[object Object]')
  })

  it('switches the review provider from the CLI', async () => {
    const h = harness()
    expect(await h.run(['config', 'set', 'reviewProvider', 'antigravity'])).toBe(0)
    expect(h.stdout.text).toContain('reviewProvider = antigravity')

    const read = harness()
    await read.run(['config', 'get', 'reviewProvider'])
    expect(read.stdout.text.trim()).toBe('antigravity')
  })

  // The value reaches a cache key and a stats row, so a typo that silently
  // became a third provider would fragment both.
  it('refuses a provider it does not have', async () => {
    const h = harness()
    expect(await h.run(['config', 'set', 'reviewProvider', 'gemini'])).toBe(2)
    expect(h.stderr.text).toMatch(/claude, antigravity/)
  })

  it('points config set at add-name instead of taking a raw value', async () => {
    const h = harness()
    const code = await h.run(['config', 'set', 'properNouns', 'İzmir'])
    expect(code).toBe(2)
    expect(h.stderr.text).toContain('add-name')
  })
})

describe('split', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    file: '/tmp/plugin-tr.po',
    dir: '/tmp/plugin-tr-split',
    entries: 9326,
    size: 1000,
    parts: Array.from({ length: 10 }, (_, i) => ({ file: `/tmp/plugin-tr-split/plugin-tr-${i + 1}.po`, entries: i === 9 ? 326 : 1000 })),
    leftBehind: [],
    ...over,
  })

  it('reports the shape of the split, including the short last part', async () => {
    const h = harness()
    const splitPo = vi.fn(async () => summary())
    expect(await h.run(['split', file, '--size', '1000'], { splitPo })).toBe(0)
    expect(h.stdout.text).toContain('9326 entries into 10 parts of 1000, last 326.')
    expect(h.stdout.text).toContain('/tmp/plugin-tr-split')
  })

  // Nothing to add when the file divides exactly; saying "last 1000" would read
  // as though the tail were special.
  it('says nothing about a tail that is a full part', async () => {
    const h = harness()
    const splitPo = vi.fn(async () =>
      summary({ entries: 2000, parts: [{ file: 'a', entries: 1000 }, { file: 'b', entries: 1000 }] }),
    )
    await h.run(['split', file, '--size', '1000'], { splitPo })
    expect(h.stdout.text).toContain('2000 entries into 2 parts of 1000.')
    expect(h.stdout.text).not.toMatch(/last/)
  })

  it('passes the size and force through', async () => {
    const h = harness()
    const calls: unknown[] = []
    const splitPo = vi.fn(async (opts: unknown) => {
      calls.push(opts)
      return summary()
    })
    await h.run(['split', file, '--size', '250', '--force'], { splitPo })
    expect(calls).toEqual([{ file, size: 250, force: true }])
  })

  // A leftover from an earlier, finer split looks exactly like work waiting to
  // be submitted, so it is named rather than deleted.
  it('names files it left alone', async () => {
    const h = harness()
    const splitPo = vi.fn(async () => summary({ leftBehind: ['plugin-tr-19.po'] }))
    await h.run(['split', file, '--size', '1000'], { splitPo })
    expect(h.stderr.text).toContain('plugin-tr-19.po')
  })

  it('requires a size rather than inventing one', async () => {
    const h = harness()
    const splitPo = vi.fn()
    expect(await h.run(['split', file], { splitPo })).toBe(2)
    expect(splitPo).not.toHaveBeenCalled()
  })

  it('refuses a size that is not a positive integer', async () => {
    const h = harness()
    const splitPo = vi.fn()
    expect(await h.run(['split', file, '--size', '0'], { splitPo })).toBe(2)
    expect(splitPo).not.toHaveBeenCalled()
  })
})

describe('review', () => {
  interface FakeReview {
    fn: CliDeps['reviewFile'] & object
    calls: Array<{ file: string; locale: string; outDir?: string; noAi?: boolean; batchSize?: number; fresh?: boolean }>
  }

  function summary(overrides = {}) {
    return {
      file: 'plugin-tr.po',
      total: 120,
      skipped: 4,
      reviewed: 116,
      problems: 14,
      needsReview: 0,
      approvable: 102,
      unreviewed: 0,
      repaired: 9,
      written: 14,
      pending: 0,
      byRule: { placeholder: 3, 'title-case': 11 },
      byGroup: { 'title-case': 8, other: 3 },
      problemsFile: '/tmp/plugin-tr-problems.po',
      ...overrides,
    }
  }

  function fakeReview(outcome: ReturnType<typeof summary> | Error = summary()): FakeReview {
    const calls: FakeReview['calls'] = []
    return {
      calls,
      async fn(opts) {
        calls.push({
          file: opts.file,
          locale: opts.locale,
          outDir: opts.outDir,
          noAi: opts.noAi,
          batchSize: opts.batchSize,
          fresh: opts.fresh,
        })
        if (outcome instanceof Error) throw outcome
        return outcome
      },
    }
  }

  it('reviews the file and reports counts and both paths', async () => {
    const h = harness()
    const review = fakeReview()
    const code = await h.run(['review', file], { reviewFile: review.fn })

    expect(code).toBe(0)
    expect(review.calls).toEqual([
      { file, locale: 'tr', outDir: undefined, noAi: undefined, batchSize: 25, fresh: undefined },
    ])
    expect(h.stdout.text).toContain('14 flagged')
    expect(h.stdout.text).toContain('102 approvable')
    expect(h.stdout.text).toContain('/tmp/plugin-tr-problems.po')
    expect(h.stdout.text).not.toContain('report')
  })

  it('counts undecided entries as flagged, since they are written to the file too', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 0, needsReview: 5, approvable: 0 }))
    await h.run(['review', file, '--no-ai'], { reviewFile: review.fn })

    expect(h.stdout.text).toContain('5 flagged')
    expect(h.stdout.text).not.toContain('0 flagged')
  })

  it('reports the needs-your-eye count from a rules-only run', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 3, needsReview: 11, approvable: 102 }))
    const code = await h.run(['review', file, '--no-ai'], { reviewFile: review.fn })

    expect(code).toBe(0)
    expect(h.stdout.text).toContain('11')
    expect(h.stdout.text).toMatch(/unadjudicated guesses/i)
  })

  it('says so when nothing was flagged and names no po file', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 0, approvable: 116, problemsFile: undefined, byRule: {} }))
    const code = await h.run(['review', file], { reviewFile: review.fn })

    expect(code).toBe(0)
    expect(h.stdout.text).toMatch(/nothing flagged/i)
    expect(h.stdout.text).not.toContain('-problems.po')
  })

  it('forwards --locale, --out-dir, --no-ai and --batch-size', async () => {
    const h = harness()
    const review = fakeReview()
    const code = await h.run(
      ['review', file, '--locale', 'PT-BR', '--out-dir', '/tmp/out', '--no-ai', '--batch-size', '10'],
      { reviewFile: review.fn },
    )

    expect(code).toBe(0)
    expect(review.calls).toEqual([
      { file, locale: 'pt-br', outDir: '/tmp/out', noAi: true, batchSize: 10, fresh: undefined },
    ])
  })

  // translate has always taken its default from config; review quietly used a
  // hard-coded 25, so setting a project default only half worked.
  it('takes the batch size from the config when no flag is given', async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ batchSize: 50 }))
    const h = harness()
    const review = fakeReview()
    await h.run(['review', file], { reviewFile: review.fn })

    expect(review.calls[0]).toMatchObject({ batchSize: 50 })
  })

  // A run that stops on an exhausted quota must say so. Silently printing a
  // smaller "approvable" than the file contains would read as a finished review.
  it('says it stopped early and how much is left', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 12, approvable: 40, pending: 2850, written: 12 }))
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).toMatch(/stopped early/i)
    expect(h.stdout.text).toContain('2850')
    expect(h.stdout.text).toMatch(/re-run/i)
  })

  // It used to print both, which reads as a finished review that found nothing.
  it('does not call a stopped submission approvable', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 0, approvable: 0, pending: 6, written: 0, problemsFile: undefined, byRule: {} }))
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).toMatch(/stopped early/i)
    expect(h.stdout.text).not.toMatch(/looks approvable/i)
  })

  it('says nothing about stopping when the run reached the end', async () => {
    const h = harness()
    const review = fakeReview(summary({ pending: 0 }))
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).not.toMatch(/stopped early/i)
  })

  // An interrupted review picks up from its marker by default, so starting over
  // needs a word for it.
  it('forwards --fresh so a resume can be refused', async () => {
    const h = harness()
    const review = fakeReview()
    const code = await h.run(['review', file, '--fresh'], { reviewFile: review.fn })

    expect(code).toBe(0)
    expect(review.calls[0]).toMatchObject({ fresh: true })
  })

  it('exits 2 when the file does not exist', async () => {
    const h = harness()
    const review = fakeReview()
    const code = await h.run(['review', join(home, 'nope.po')], { reviewFile: review.fn })

    expect(code).toBe(2)
    expect(review.calls).toEqual([])
  })

  it('exits 1 with the message when the review throws', async () => {
    const h = harness()
    const review = fakeReview(new Error('No cached glossary for locale "tr"; run: polyglots glossary sync'))
    const code = await h.run(['review', file], { reviewFile: review.fn })

    expect(code).toBe(1)
    expect(h.stderr.text).toContain('No cached glossary')
  })

  it('mentions unreviewed entries when some could not be checked', async () => {
    const h = harness()
    const review = fakeReview(summary({ unreviewed: 7 }))
    await h.run(['review', file], { reviewFile: review.fn })
    expect(h.stdout.text).toContain('7')
    expect(h.stdout.text).toMatch(/unreviewed|could not be reviewed/i)
  })

  it('says how much of the work it already did', async () => {
    const h = harness()
    const review = fakeReview(
      summary({ problems: 412, needsReview: 0, approvable: 2393, repaired: 380, written: 412 }),
    )
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).toContain('380 repaired')
    expect(h.stdout.text).toContain('32 left for you')
  })

  // Whitespace-only fixes are written but count as neither a problem nor a
  // needsReview entry, so flagged (problems + needsReview) undercounts what
  // was written. Subtracting repaired from flagged instead of written would
  // print a negative "left for you" here.
  it('never goes negative when everything written was a mechanical fix', async () => {
    const h = harness()
    const review = fakeReview(summary({ problems: 0, needsReview: 0, approvable: 10, repaired: 10, written: 10 }))
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).toContain('10 repaired, 0 left for you')
    expect(h.stdout.text).not.toMatch(/-\d+ left for you/)
  })

  it('prints the message to post back to the requester', async () => {
    const h = harness()
    const review = fakeReview(
      summary({ repaired: 37, byGroup: { glossary: 24, meaning: 11, 'title-case': 6, other: 5 } }),
    )
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).toContain('Message for the requester:')
    expect(h.stdout.text).toContain(
      'I fixed 37 entries, which you can see <a href="">here</a>. They included ~25 glossary inconsistencies, ' +
        '~10 meaning and fluency problems and ~5 title-case issues, plus a few smaller ones.',
    )
  })

  // Nothing repaired is nothing to report, and printing a headline with no
  // sentence under it would read as output that went missing.
  it('prints no requester message when nothing was repaired', async () => {
    const h = harness()
    const review = fakeReview(summary({ repaired: 0, byGroup: {} }))
    await h.run(['review', file], { reviewFile: review.fn })

    expect(h.stdout.text).not.toContain('Message for the requester')
  })

  it('says nothing about repairs when there were none', async () => {
    const h = harness()
    const review = fakeReview(
      summary({ problems: 0, approvable: 116, repaired: 0, problemsFile: undefined, byRule: {} }),
    )
    await h.run(['review', file], { reviewFile: review.fn })
    expect(h.stdout.text).not.toContain('repaired')
  })
})

describe('glossary export', () => {
  interface FakeExport {
    fn: CliDeps['exportGlossary'] & object
    calls: Array<{ locale: string; file?: string; delimiter?: string }>
  }

  function fakeExport(outcome: { entries: number; csv: string; file?: string } | Error): FakeExport {
    const calls: Array<{ locale: string; file?: string; delimiter?: string }> = []
    return {
      calls,
      async fn(opts) {
        calls.push({ locale: opts.locale, file: opts.file, delimiter: opts.delimiter })
        if (outcome instanceof Error) throw outcome
        return outcome
      },
    }
  }

  it('writes to the given path and reports the count', async () => {
    const h = harness()
    const exp = fakeExport({ entries: 511, csv: 'x', file: '/tmp/g.csv' })
    const code = await h.run(['glossary', 'export', '/tmp/g.csv'], { exportGlossary: exp.fn })
    expect(code).toBe(0)
    expect(exp.calls).toEqual([{ locale: 'tr', file: '/tmp/g.csv', delimiter: ';' }])
    expect(h.stdout.text).toBe('Exported 511 glossary terms (tr) to /tmp/g.csv\n')
  })

  it('prints the csv to stdout when no path is given', async () => {
    const h = harness()
    const exp = fakeExport({ entries: 2, csv: 'Term;Translation;Notes\na;b;c\n' })
    const code = await h.run(['glossary', 'export'], { exportGlossary: exp.fn })
    expect(code).toBe(0)
    expect(exp.calls).toEqual([{ locale: 'tr', file: undefined, delimiter: ';' }])
    expect(h.stdout.text).toBe('Term;Translation;Notes\na;b;c\n')
  })

  it('forwards --locale and --delimiter', async () => {
    const h = harness()
    const exp = fakeExport({ entries: 1, csv: 'x', file: 'g.csv' })
    const code = await h.run(['glossary', 'export', 'g.csv', '--locale', 'PT-BR', '--delimiter', ','], {
      exportGlossary: exp.fn,
    })
    expect(code).toBe(0)
    expect(exp.calls).toEqual([{ locale: 'pt-br', file: 'g.csv', delimiter: ',' }])
  })

  it('rejects a delimiter that is not a comma or semicolon', async () => {
    const h = harness()
    const exp = fakeExport({ entries: 1, csv: 'x' })
    const code = await h.run(['glossary', 'export', '--delimiter', '|'], { exportGlossary: exp.fn })
    expect(code).toBe(2)
    expect(exp.calls).toEqual([])
    expect(h.stderr.text).toContain('delimiter')
  })

  it('exits 1 with the message when nothing is cached for the locale', async () => {
    const h = harness()
    const exp = fakeExport(new Error('No cached glossary for locale "de"; run: polyglots glossary sync --locale de'))
    const code = await h.run(['glossary', 'export', '--locale', 'de'], { exportGlossary: exp.fn })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('No cached glossary for locale "de"')
    expect(h.stdout.text).toBe('')
  })
})

describe('tm import', () => {
  it('forwards --project and the config default locale to the importer', async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ defaultLocale: 'de' }))
    const h = harness()
    const calls: Array<{ files: string[]; locale: string; project?: string }> = []
    const importTmx: CliDeps['importTmx'] = async (files, opts) => {
      calls.push({ files, locale: opts.locale, project: opts.project })
      opts.onProgress?.({ file: files[0] ?? '', entries: 5, upserted: 4 })
      return { files: files.length, entries: 5, upserted: 4 }
    }
    const code = await h.run(['tm', 'import', file, '--project', 'woocommerce'], { importTmx })
    expect(code).toBe(0)
    expect(calls).toEqual([{ files: [file], locale: 'de', project: 'woocommerce' }])
    expect(h.stderr.text).toContain(`${file}: 5 entries, 4 upserted`)
    expect(h.stdout.text).toBe('Imported 1 file(s): 5 entries, 4 upserted (locale de).\n')
  })
})

describe('no arguments', () => {
  it('dispatches to runTui and exits 0 when it resolves', async () => {
    const h = harness()
    let calls = 0
    const code = await h.run([], {
      runTui: async () => {
        calls += 1
      },
    })
    expect(code).toBe(0)
    expect(calls).toBe(1)
    expect(h.stdout.text).toBe('')
  })

  it('exits 1 with the message when runTui rejects', async () => {
    const h = harness()
    const code = await h.run([], {
      runTui: async () => {
        throw new Error('The interactive menu needs a terminal; run a subcommand instead (see polyglots --help).')
      },
    })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('needs a terminal')
  })
})

describe('--version', () => {
  it('prints the package.json version', async () => {
    const h = harness()
    const code = await h.run(['--version'])
    expect(code).toBe(0)
    expect(h.stdout.text.trim()).toBe(pkg.version)
  })
})

describe('translate fail-fast on a missing engine key', () => {
  it('exits 1 before prompting or calling translateFile', async () => {
    delete process.env.DEEPL_API_KEY
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--all'], { translate: translate.fn, stdin: stdinWith('y\n', true), tty: true })
    expect(code).toBe(1)
    expect(translate.calls).toHaveLength(0)
    expect(h.stderr.text).toMatch(/DEEPL_API_KEY/)
    expect(h.stderr.text).toContain('config set-key DEEPL_API_KEY')
    expect(h.stderr.text).not.toContain('Continue?')
    expect(h.stdout.text).toBe('')
  })

  it('names the key of the selected engine', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file, '--draft-engine', 'openai'], { translate: translate.fn })
    expect(code).toBe(1)
    expect(h.stderr.text).toMatch(/OPENAI_API_KEY/)
    expect(translate.calls).toHaveLength(0)
  })
})

describe('translate error output on a TTY', () => {
  it('clears the live progress line before printing the error', async () => {
    const h = harness()
    const translate = fakeTranslate(() => new Error('boom'))
    const code = await h.run(['translate', file], { translate: translate.fn, tty: true })
    expect(code).toBe(1)
    expect(h.stderr.text).toMatch(new RegExp(`\\r\\x1b\\[2KError: ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: boom\\n$`))
    expect(h.stderr.text).not.toMatch(/0\/7Error/)
  })
})

describe('corrupt config file', () => {
  beforeEach(async () => {
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(join(home, 'config', 'config.json'), '{ not json')
  })

  it('still shows help and exits 0', async () => {
    const h = harness()
    const code = await h.run(['--help'])
    expect(code).toBe(0)
    expect(h.stdout.text).toMatch(/^\s+translate\b/m)
    const sub = harness()
    expect(await sub.run(['translate', '--help'])).toBe(0)
    expect(sub.stdout.text).toContain('default: tr')
    expect(sub.stdout.text).toContain('POLYGLOTS_CLAUDE_BIN')
  })

  it('fails a translate run with the config error instead of silently using defaults', async () => {
    const h = harness()
    const translate = fakeTranslate()
    const code = await h.run(['translate', file], { translate: translate.fn })
    expect(code).toBe(1)
    expect(h.stderr.text).toMatch(/Invalid JSON in config file/)
    expect(translate.calls).toHaveLength(0)
  })
})

describe('config set-key prompt', () => {
  it('reports a cancelled hidden prompt (Ctrl-C) with exit 1 instead of hanging', async () => {
    const h = harness()
    const code = await h.run(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: stdinWith('\x03', true) })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('Cancelled.')
    expect(h.stdout.text).toBe('')
  })

  it('treats a closed hidden prompt as cancelled', async () => {
    const h = harness()
    const code = await h.run(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: stdinWith(undefined, true) })
    expect(code).toBe(1)
    expect(h.stderr.text).toContain('Cancelled.')
  })

  it('reads a piped value without echoing it', async () => {
    const h = harness()
    const key = 'dpl-PIPED-0123456789:fx'
    const code = await h.run(['config', 'set-key', 'DEEPL_API_KEY'], { stdin: stdinWith(`${key}\n`, false) })
    expect(code).toBe(0)
    expect(h.stdout.text + h.stderr.text).not.toContain(key)
    expect(h.stdout.text).toContain('dpl-…fx')
  })
})

describe('usage errors through injected streams', () => {
  it('routes commander errors to the injected stderr with exit 2', async () => {
    const h = harness()
    const code = await h.run(['translate', file, '--bogus'])
    expect(code).toBe(2)
    expect(h.stderr.text).toMatch(/unknown option/i)
    expect(h.stdout.text).toBe('')
  })
})
