import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { main, type CliDeps } from '../../src/cli.js'
import type { TranslateOptions, TranslateSummary } from '../../src/commands/translate.js'
import type { ReviewOptions } from '../../src/commands/review.js'

// No AI mode from the command line: reviewProvider none and --draft-engine
// none. Every test runs with no agent on PATH and no API key in the
// environment, and the agent discovery a doctor run would do is a fake that
// records whether it was asked at all.

const samplePo = fileURLToPath(new URL('../fixtures/po/sample.po', import.meta.url))

interface Sink {
  isTTY?: boolean
  text: string
  write(chunk: string): boolean
}

function sink(): Sink {
  return {
    text: '',
    write(chunk: string) {
      this.text += chunk
      return true
    },
  }
}

function stdin(): PassThrough & { isTTY?: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean }
  stream.isTTY = false
  stream.end()
  return stream
}

function harness() {
  const stdout = sink()
  const stderr = sink()
  return {
    stdout,
    stderr,
    run: (argv: string[], deps: Omit<CliDeps, 'streams'> = {}) =>
      main(argv, { env: {}, ...deps, streams: { stdin: stdin(), stdout, stderr } }),
  }
}

let home: string
let file: string
let saved: NodeJS.ProcessEnv

async function writeConfig(config: Record<string, unknown>): Promise<void> {
  await mkdir(join(home, 'config'), { recursive: true })
  await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ defaultLocale: 'tr', ...config }))
}

async function configJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(home, 'config', 'config.json'), 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  saved = { ...process.env }
  home = await mkdtemp(join(tmpdir(), 'polyglots-cli-noai-'))
  file = join(home, 'sample.po')
  await copyFile(samplePo, file)
  process.env.POLYGLOTS_HOME = home
  process.env.PATH = ''
  process.env.POLYGLOTS_AGENT_BIN = '/nonexistent/agent'
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
  await writeConfig({})
})

afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  await rm(home, { recursive: true, force: true })
})

function fakeReviewFile() {
  const calls: ReviewOptions[] = []
  const fn: NonNullable<CliDeps['reviewFile']> = async (opts) => {
    calls.push(opts)
    return {
      file: opts.file,
      locale: opts.locale,
      total: 1,
      skipped: 0,
      reviewed: 1,
      problems: 0,
      needsReview: 2,
      approvable: 0,
      unreviewed: 0,
      repaired: 0,
      written: 2,
      pending: 0,
      byRule: {},
      byGroup: {},
      problemsFile: join(home, 'sample-problems.po'),
    }
  }
  return { fn, calls }
}

function fakeTranslate(patch: Partial<TranslateSummary> = {}) {
  const calls: TranslateOptions[] = []
  const fn = async (opts: TranslateOptions): Promise<TranslateSummary> => {
    calls.push(opts)
    return { file: opts.file, total: 12, pending: 7, fromTm: 2, translated: 0, fuzzy: 0, skipped: 0, ...patch }
  }
  return { fn, calls }
}

const discoverNothing = () => {
  const calls: unknown[] = []
  return {
    calls,
    fn: (async (opts?: unknown) => {
      calls.push(opts)
      return []
    }) as NonNullable<CliDeps['discoverAgents']>,
  }
}

describe('config set', () => {
  it('takes reviewProvider none and defaultDraftEngine none', async () => {
    const h = harness()
    expect(await h.run(['config', 'set', 'reviewProvider', 'none'])).toBe(0)
    expect(await h.run(['config', 'set', 'defaultDraftEngine', 'none'])).toBe(0)
    expect(await configJson()).toMatchObject({ reviewProvider: 'none', defaultDraftEngine: 'none' })
    expect(h.stderr.text).not.toContain('experimental')
  })

  it('names none among the choices when a provider is mistyped', async () => {
    const h = harness()
    expect(await h.run(['config', 'set', 'reviewProvider', 'nobody'])).toBe(2)
    expect(h.stderr.text).toContain('none')
  })
})

describe('review with reviewProvider none', () => {
  it('runs rules only without --no-ai, and says so on stderr', async () => {
    await writeConfig({ reviewProvider: 'none' })
    const h = harness()
    const review = fakeReviewFile()
    expect(await h.run(['review', file], { reviewFile: review.fn })).toBe(0)
    expect(review.calls[0]).toMatchObject({ noAi: true })
    expect(review.calls[0]!.bin).toBeUndefined()
    expect(h.stderr.text).toMatch(/reviewProvider is none.*rules only/i)
    expect(h.stderr.text).toMatch(/review\s+rules only/)
    // The advice --no-ai gives about its guesses would send this person to an
    // AI they chose not to use.
    expect(h.stdout.text).not.toContain('re-run without --no-ai')
    expect(h.stdout.text).toMatch(/guesses\s+2/)
  })

  it('says nothing of the kind for an agent provider', async () => {
    const h = harness()
    const review = fakeReviewFile()
    await h.run(['review', file, '--no-ai'], { reviewFile: review.fn })
    expect(h.stderr.text).not.toContain('reviewProvider is none')
    expect(h.stdout.text).toContain('re-run without --no-ai')
  })
})

describe('translate --draft-engine none', () => {
  it('needs no API key, passes none through, and says how many it left untranslated', async () => {
    const h = harness()
    const translate = fakeTranslate({ untranslated: 5 })
    expect(await h.run(['translate', file, '--draft-engine', 'none'], { translate: translate.fn })).toBe(0)
    expect(translate.calls[0]).toMatchObject({ draftEngine: 'none' })
    expect(translate.calls[0]!.bin).toBeUndefined()
    expect(h.stdout.text).toMatch(/untranslated\s+5/)
    expect(h.stderr.text).toMatch(/draft\s+none/)
    expect(h.stderr.text).toMatch(/review\s+skipped/)
  })

  it('takes none from defaultDraftEngine', async () => {
    await writeConfig({ defaultDraftEngine: 'none', reviewProvider: 'none' })
    const h = harness()
    const translate = fakeTranslate({ untranslated: 5 })
    expect(await h.run(['translate', file], { translate: translate.fn })).toBe(0)
    expect(translate.calls[0]).toMatchObject({ draftEngine: 'none' })
  })

  it('does not check a local reviewer it will never ask', async () => {
    await writeConfig({ reviewProvider: 'local', localServerKind: 'openai-compatible' })
    const h = harness()
    const checks: unknown[] = []
    const code = await h.run(['translate', file, '--draft-engine', 'none'], {
      translate: fakeTranslate().fn,
      checkLocalModel: async (t) => {
        checks.push(t)
        throw new Error('not expected')
      },
    })
    expect(code).toBe(0)
    expect(checks).toEqual([])
  })

  it('names the drafts as unreviewed when the engine drafts and nobody reviews', async () => {
    await writeConfig({ reviewProvider: 'none' })
    process.env.DEEPL_API_KEY = 'dpl-test-key-0123456789:fx'
    const h = harness()
    await h.run(['translate', file, '--draft-engine', 'deepl'], { translate: fakeTranslate().fn })
    expect(h.stderr.text).toMatch(/review\s+none, drafts written fuzzy/)
  })
})

describe('doctor with reviewProvider none', () => {
  it('reports the mode, asks no agent anything, and exits 0', async () => {
    await writeConfig({ reviewProvider: 'none' })
    const h = harness()
    const discover = discoverNothing()
    expect(await h.run(['doctor'], { discoverAgents: discover.fn })).toBe(0)
    expect(discover.calls).toEqual([])
    expect(h.stdout.text).toContain('Review provider: none (rules only, no AI)')
  })

  it('says the same in JSON', async () => {
    await writeConfig({ reviewProvider: 'none' })
    const h = harness()
    expect(await h.run(['doctor', '--json'], { discoverAgents: discoverNothing().fn })).toBe(0)
    expect(JSON.parse(h.stdout.text)).toEqual({ configured: 'none', agents: [] })
  })
})
