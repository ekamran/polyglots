import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { render as inkRender } from 'ink-testing-library'
import { vi } from 'vitest'
import { loadConfig, saveConfig, loadSecrets, saveSecret } from '../../src/config.js'
import type { Fetched, Ready, Resolution } from '../../src/commands/fetch.js'
import type { SplitOptions } from '../../src/commands/split.js'
import type { StatsOptions } from '../../src/commands/stats.js'
import type { ExportTmOptions } from '../../src/commands/tm-export.js'
import type { TmImportOptions } from '../../src/commands/tm-import.js'
import type { TranslateEvent, TranslateOptions, TranslateSummary } from '../../src/commands/translate.js'
import type { ReviewFileOptions, TuiCommands } from '../../src/tui/commands.js'
import { MENU_ITEMS, type MenuAction } from '../../src/tui/screens/Menu.js'
import type { AgentStatus } from '../../src/agent/discover.js'
import type { ModelCheck, ModelServer } from '../../src/draft/discover.js'
import type { ReviewProvider, ReviewSummary } from '../../src/types.js'
import type { FetchStatus, ProjectRef } from '../../src/wporg/projects.js'

const ANSI = /\[[0-9;]*m/g
const strip = (s: string | undefined): string => (s ?? '').replace(ANSI, '')
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const stripAll = (s: string | undefined): string => (s ?? '').replace(CSI, '')

export function render(tree: ReactElement) {
  const instance = inkRender(tree)
  return {
    stdin: instance.stdin,
    unmount: instance.unmount,
    rerender: instance.rerender,
    lastFrame: (): string => strip(instance.lastFrame()),
    get frames(): string[] {
      return instance.frames.map(strip)
    },
  }
}

// Minimal stand-ins for process.stdin/stdout, modelled on ink-testing-library's, for driving runTui().
export class FakeStdout extends EventEmitter {
  isTTY = true
  readonly frames: string[] = []
  private last: string | undefined
  get columns(): number {
    return 100
  }
  // Ink writes cursor and synchronized-output markers as separate chunks around each frame;
  // only chunks with visible text count as frames.
  write = (chunk: string): boolean => {
    this.frames.push(chunk)
    if (stripAll(chunk).trim().length > 0) this.last = stripAll(chunk)
    return true
  }
  lastFrame = (): string | undefined => this.last
  asStream(): NodeJS.WriteStream {
    return this as unknown as NodeJS.WriteStream
  }
}

export class FakeStdin extends EventEmitter {
  isTTY = true
  private data: string | null = null
  write = (data: string): void => {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }
  read = (): string | null => {
    const { data } = this
    this.data = null
    return data
  }
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  asStream(): NodeJS.ReadStream {
    return this as unknown as NodeJS.ReadStream
  }
}

export const keys = {
  up: '[A',
  down: '[B',
  left: '[D',
  right: '[C',
  enter: '\r',
  backspace: '',
  esc: '',
  tab: '\t',
}

// How many times to press down to land on an action. Derived rather than
// counted by hand: a new menu item used to shift every index below it and
// break these tests for a reason that had nothing to do with what they test.
export function hopsTo(action: MenuAction): number {
  const at = MENU_ITEMS.findIndex((item) => item.value === action)
  if (at < 0) throw new Error(`no menu item for ${action}`)
  return at
}

export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Ink holds a bare ESC for 20ms to disambiguate it from escape sequences.
export const ESC_DELAY = 40

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await tick(5)
  }
}

export async function waitForText(frame: () => string | undefined, text: string | RegExp): Promise<void> {
  const matches = (): boolean => {
    const f = frame() ?? ''
    return typeof text === 'string' ? f.includes(text) : text.test(f)
  }
  try {
    await waitFor(matches)
  } catch {
    throw new Error(`waitForText: ${String(text)} not found in frame:\n${frame()}`)
  }
  // Ink re-attaches its stdin listener in a passive effect after the frame is painted;
  // input written before that effect flushes would be dropped.
  await tick()
}

export const flat = (frame: string | undefined): string => (frame ?? '').replace(/\s+/g, ' ')

export interface Home {
  path: string
  cleanup(): Promise<void>
}

const savedEnv = { ...process.env }

export async function makeHome(): Promise<Home> {
  const path = await mkdtemp(join(tmpdir(), 'polyglots-tui-'))
  process.env.POLYGLOTS_HOME = path
  delete process.env.DEEPL_API_KEY
  delete process.env.OPENAI_API_KEY
  return {
    path,
    cleanup: async () => {
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
      Object.assign(process.env, savedEnv)
      delete process.env.POLYGLOTS_HOME
      await rm(path, { recursive: true, force: true })
    },
  }
}

export function summaryOf(file: string, patch: Partial<TranslateSummary> = {}): TranslateSummary {
  return { file, total: 10, pending: 4, fromTm: 1, translated: 3, fuzzy: 1, skipped: 0, ...patch }
}

export function scriptedTranslate(events: (file: string) => TranslateEvent[]): TuiCommands['translateFile'] {
  return async (opts: TranslateOptions) => {
    let summary: TranslateSummary = summaryOf(opts.file)
    for (const e of events(opts.file)) {
      if (e.type === 'done') summary = e.summary
      opts.onProgress?.(e)
      await tick()
    }
    return summary
  }
}

export function reviewSummaryOf(file: string, patch: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    file,
    locale: 'tr',
    total: 10,
    skipped: 2,
    reviewed: 8,
    problems: 3,
    needsReview: 0,
    approvable: 5,
    unreviewed: 0,
    repaired: 1,
    written: 3,
    pending: 0,
    byRule: { 'title-case': 2, glossary: 1 },
    byGroup: { 'title-case': 1 },
    problemsFile: `${file.replace(/\.po$/, '')}-problems.po`,
    ...patch,
  }
}

// A ready agent unless the patch says otherwise. The default fake discovery
// reports both providers usable, so every test that does not care about
// discovery sees the menu behave as it did before discovery existed.
export function agentStatus(provider: ReviewProvider, patch: Partial<AgentStatus> = {}): AgentStatus {
  const bin = provider === 'claude' ? 'claude' : 'agy'
  return {
    provider,
    bin,
    binSource: 'default',
    path: `/opt/bin/${bin}`,
    version: `${bin} 1.0.0`,
    auth: { state: 'signed-in' },
    setup: { state: 'ok' },
    usable: true,
    notes: [],
    ...patch,
  }
}

export function unusableAgent(provider: ReviewProvider, reason: string): AgentStatus {
  const status = agentStatus(provider, { usable: false, reason, auth: { state: 'unknown', detail: 'not checked' } })
  delete status.path
  delete status.version
  return status
}

// An Ollama server holding the default draft model unless the patch says
// otherwise, so a test that does not care about local models sees the
// configured one installed.
export function modelServer(patch: Partial<ModelServer> = {}): ModelServer {
  return {
    target: { baseUrl: 'http://localhost:11434', kind: 'ollama', label: 'Ollama', source: 'default' },
    state: 'up',
    kind: 'ollama',
    selectable: true,
    models: [{ name: 'qwen3.8:27b-mlx', model: 'qwen3.8:27b-mlx', size: 17_200_000_000, parameterSize: '27B', quantization: 'Q4_K_M' }],
    ...patch,
  }
}

export function fakeCommands(overrides: Partial<TuiCommands> = {}): TuiCommands {
  return {
    writeStats: vi.fn(async (opts: StatsOptions = {}) => ({
      file: opts.out ?? 'polyglots-stats.html',
      submissions: 4,
      entries: 120,
      incomplete: 0,
      translateRuns: 2,
      translateEntries: 900,
    })),
    translateFile: vi.fn(async (opts: TranslateOptions) => {
      const summary = summaryOf(opts.file)
      opts.onProgress?.({ type: 'start', file: opts.file, total: summary.total, pending: summary.pending })
      opts.onProgress?.({ type: 'done', summary })
      return summary
    }),
    importTmx: vi.fn(async (files: string[], opts: TmImportOptions) => {
      for (const file of files) opts.onProgress?.({ file, entries: 3, upserted: 2 })
      return { files: files.length, entries: 3 * files.length, upserted: 2 * files.length }
    }),
    syncGlossary: vi.fn(async () => ({ entries: 42 })),
    splitPo: vi.fn(async (opts: SplitOptions) => ({
      file: opts.file,
      dir: opts.file.replace(/\.po$/, '-split'),
      entries: 10,
      size: opts.size,
      parts: [{ file: 'part-01.po', entries: opts.size }],
      leftBehind: [],
    })),
    reviewFile: vi.fn(async (opts: ReviewFileOptions) => {
      const summary = reviewSummaryOf(opts.file)
      opts.onProgress?.({ type: 'start', file: opts.file, total: summary.total, reviewable: summary.reviewed })
      opts.onProgress?.({ type: 'done', summary })
      return summary
    }),
    // Every slug resolves as a theme with work, and every download succeeds.
    // The network is never touched: a test that wants another answer passes one.
    resolveProjects: vi.fn(async (refs: ProjectRef[], opts: { status: FetchStatus }) =>
      refs.map((r): Resolution => ({ input: r.slug, state: 'ready', type: 'wp-themes', slug: r.slug, count: opts.status === 'waiting' ? 5 : 3 })),
    ),
    fetchProjects: vi.fn(async (ready: Ready[], opts: { outDir: string }) =>
      ready.map((p): Fetched => ({ input: p.input, state: 'fetched', file: join(opts.outDir, `${p.type}-${p.slug}-tr.po`) })),
    ),
    // Never touches the memory: a test of the screen must not read polyglots.db.
    exportTm: vi.fn(async (opts: ExportTmOptions) => ({
      entries: 120,
      dropped: opts.format === 'po' ? 7 : 0,
      text: '',
      ...(opts.file === undefined ? {} : { file: opts.file }),
    })),
    // Never the real discovery: a TUI test must not spawn whatever agent CLI
    // happens to be installed.
    discoverAgents: vi.fn(async () => [agentStatus('claude'), agentStatus('antigravity')]),
    // Never the real probes either: a TUI test must not send a request to
    // whatever happens to be listening on 11434.
    discoverModels: vi.fn(async () => [modelServer()]),
    checkOllamaModel: vi.fn(
      async (ollama: { baseUrl: string; model: string }): Promise<ModelCheck> => ({ state: 'installed', ...ollama }),
    ),
    loadConfig,
    saveConfig,
    loadSecrets,
    saveSecret,
    ...overrides,
  }
}
