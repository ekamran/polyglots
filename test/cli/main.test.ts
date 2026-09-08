import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
      emit({ type: 'batch-start', index: 1, of: 1, size: 6 })
      emit({ type: 'batch-done', index: 1, translated: summary.translated, fuzzy: summary.fuzzy })
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
    expect(h.stderr.text).toContain('[##########] 7/7  batch 1/1  fuzzy 1')
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
