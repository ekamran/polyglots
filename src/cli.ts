#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { Command, CommanderError } from 'commander'
import { exportGlossary } from './commands/glossary-export.js'
import { syncGlossary } from './commands/glossary-sync.js'
import { reviewFile } from './commands/review.js'
import { importTmx } from './commands/tm-import.js'
import { translateFile, type TranslateSummary } from './commands/translate.js'
import { DEFAULT_CONFIG, loadConfig, loadSecrets, maskSecret, saveConfig, saveSecret } from './config.js'
import {
  UsageError,
  expandFileArgs,
  isSecretName,
  parseCsvDelimiter,
  parseDraftEngine,
  parseLocaleArg,
  parsePositiveInt,
  parseSecretName,
  secretForEngine,
} from './cli/args.js'
import { createProgressReporter, createReviewProgressReporter } from './cli/progress.js'
import { loadPo } from './po/po-file.js'
import type { RunTuiOptions } from './tui/index.js'
import type { Locale, PolyglotsConfig } from './types.js'

const EXIT_OK = 0
const EXIT_ERROR = 1
const EXIT_USAGE = 2
const EXIT_STOPPED = 3

const { version: VERSION } = createRequire(import.meta.url)('../package.json') as { version: string }

export interface CliStreams {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  stdout: { write(chunk: string): boolean }
  stderr: { isTTY?: boolean; write(chunk: string): boolean }
}

export type RunTui = (opts?: RunTuiOptions) => Promise<void>

export interface CliDeps {
  streams?: Partial<CliStreams>
  translate?: typeof translateFile
  importTmx?: typeof importTmx
  syncGlossary?: typeof syncGlossary
  exportGlossary?: typeof exportGlossary
  reviewFile?: typeof reviewFile
  runTui?: RunTui
}

interface Cli {
  streams: CliStreams
  translate: typeof translateFile
  importTmx: typeof importTmx
  syncGlossary: typeof syncGlossary
  exportGlossary: typeof exportGlossary
  reviewFile: typeof reviewFile
  runTui: RunTui
  config: () => PolyglotsConfig
  out(line: string): void
  err(line: string): void
}

// Loaded lazily so subcommands never pay for ink/react startup.
const loadTui: RunTui = async (opts) => {
  const { runTui } = await import('./tui/index.js')
  await runTui(opts)
}

function createCli(deps: CliDeps): Cli {
  const streams: CliStreams = {
    stdin: deps.streams?.stdin ?? process.stdin,
    stdout: deps.streams?.stdout ?? process.stdout,
    stderr: deps.streams?.stderr ?? process.stderr,
  }
  let cached: PolyglotsConfig | undefined
  return {
    streams,
    translate: deps.translate ?? translateFile,
    importTmx: deps.importTmx ?? importTmx,
    syncGlossary: deps.syncGlossary ?? syncGlossary,
    exportGlossary: deps.exportGlossary ?? exportGlossary,
    reviewFile: deps.reviewFile ?? reviewFile,
    runTui: deps.runTui ?? loadTui,
    config: () => (cached ??= loadConfig()),
    out: (line) => streams.stdout.write(`${line}\n`),
    err: (line) => streams.stderr.write(`${line}\n`),
  }
}

// Resolves to undefined when the interface closes without an answer (Ctrl-D, Ctrl-C in
// terminal mode, or a closed pipe); rl.question alone would leave the promise pending.
function ask(streams: CliStreams, question: string, hidden: boolean): Promise<string | undefined> {
  return new Promise((resolve) => {
    const output = hidden ? new Writable({ write: (_chunk, _enc, cb) => cb() }) : streams.stderr
    const rl = createInterface({ input: streams.stdin, output: output as NodeJS.WritableStream, terminal: hidden })
    let settled = false
    const settle = (answer: string | undefined) => {
      if (settled) return
      settled = true
      rl.close()
      resolve(answer)
    }
    rl.once('close', () => settle(undefined))
    rl.question(question, settle)
  })
}

async function confirm(streams: CliStreams, question: string): Promise<boolean> {
  const answer = await ask(streams, question, false)
  return answer !== undefined && /^y(es)?$/i.test(answer.trim())
}

async function readSecretFromStdin(streams: CliStreams, name: string): Promise<string | undefined> {
  if (!streams.stdin.isTTY) {
    const raw = await text(streams.stdin)
    return raw.split(/\r?\n/)[0] ?? ''
  }
  streams.stderr.write(`Enter value for ${name} (input hidden): `)
  try {
    return await ask(streams, '', true)
  } finally {
    streams.stderr.write('\n')
  }
}

function summaryLine(s: TranslateSummary, dryRun: boolean): string {
  const counts = `${s.translated} translated, ${s.fuzzy} fuzzy, ${s.fromTm} from TM, ${s.skipped} skipped.`
  if (s.stopped) return `Stopped. ${counts} ${dryRun ? 'Nothing was written.' : 'Re-run the same command to resume.'}`
  if (dryRun) return `Dry run. ${counts} Nothing was written.`
  return `Done. ${counts} Open ${s.file} in PoEdit to review.`
}

async function countTranslated(files: string[]): Promise<number> {
  let n = 0
  for (const file of files) {
    const po = await loadPo(file)
    n += po.units('all').length - po.units('pending').length
  }
  return n
}

interface TranslateFlags {
  all?: boolean
  dryRun?: boolean
  draftEngine?: string
  locale?: string
  batchSize?: string
  model?: string
  yes?: boolean
}

async function runTranslate(cli: Cli, patterns: string[], flags: TranslateFlags): Promise<number> {
  const files = expandFileArgs(patterns)
  const config = cli.config()
  const locale = parseLocaleArg(flags.locale ?? config.defaultLocale)
  const draftEngine = parseDraftEngine(flags.draftEngine ?? config.defaultDraftEngine)
  const batchSize = flags.batchSize === undefined ? config.batchSize : parsePositiveInt('--batch-size', flags.batchSize)
  const dryRun = flags.dryRun === true
  const mustConfirm = flags.all === true && flags.yes !== true && !dryRun
  // The prompt is written to stderr, so a redirected stderr would leave the user staring at
  // a silent process waiting for input.
  const interactive = cli.streams.stdin.isTTY === true && cli.streams.stderr.isTTY === true
  if (mustConfirm && !interactive) {
    throw new UsageError('--all requires --yes when stdin or stderr is not a terminal (it re-translates already-translated entries)')
  }

  const secrets = loadSecrets()
  const secretName = secretForEngine(draftEngine)
  if (!secrets[secretName]?.trim()) {
    throw new Error(`Draft engine "${draftEngine}" needs ${secretName}. Set it with: polyglots config set-key ${secretName}`)
  }

  if (mustConfirm) {
    const n = await countTranslated(files)
    if (!(await confirm(cli.streams, `This will re-translate ${n} already-translated entries. Continue? [y/N] `))) {
      cli.err('Aborted.')
      return EXIT_ERROR
    }
  }

  // One unreadable file must not abort the rest of a multi-file run; report it and move on.
  let failed = 0
  for (const file of files) {
    const report = createProgressReporter(cli.streams.stderr)
    let summary: TranslateSummary
    try {
      summary = await cli.translate({
        file,
        locale,
        mode: flags.all ? 'all' : 'pending',
        draftEngine,
        dryRun,
        batchSize,
        model: flags.model,
        secrets,
        claudeBin: process.env.POLYGLOTS_CLAUDE_BIN || undefined,
        onProgress: report,
      })
    } catch (error) {
      report.finish()
      cli.err(`Error: ${file}: ${errorMessage(error)}`)
      failed += 1
      continue
    }
    report.finish()
    cli.out(summaryLine(summary, dryRun))
    if (summary.stopped) {
      cli.err(`Stopped: ${summary.stopped}`)
      cli.err('Already-written entries are kept; re-run the same command to resume.')
      return EXIT_STOPPED
    }
  }
  return failed > 0 ? EXIT_ERROR : EXIT_OK
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as Array<keyof PolyglotsConfig>

function isConfigKey(key: string): key is keyof PolyglotsConfig {
  return (CONFIG_KEYS as string[]).includes(key)
}

function coerceConfigValue(key: keyof PolyglotsConfig, raw: string): PolyglotsConfig[typeof key] {
  switch (key) {
    case 'batchSize':
      return parsePositiveInt(key, raw)
    case 'consistencyTtlDays':
      if (!/^\d+$/.test(raw.trim())) throw new UsageError(`${key} must be a non-negative integer, got "${raw}"`)
      return Number(raw)
    case 'defaultDraftEngine':
      return parseDraftEngine(raw)
    case 'defaultLocale':
      return parseLocaleArg(raw)
    case 'properNouns':
      throw new UsageError('properNouns is a per-locale list; add entries with: polyglots config add-name <name>')
  }
}

function formatConfigValue(key: keyof PolyglotsConfig, value: PolyglotsConfig[keyof PolyglotsConfig]): string {
  if (key !== 'properNouns') return String(value)
  const byLocale = value as Record<string, string[]>
  const locales = Object.keys(byLocale).sort()
  if (locales.length === 0) return '(none)'
  return locales.map((locale) => `${locale}: ${byLocale[locale]!.join(', ')}`).join(' | ')
}

function configAddName(cli: Cli, name: string, locale: Locale): number {
  const trimmed = name.trim()
  if (!trimmed) throw new UsageError('name must not be empty')
  const existing = cli.config().properNouns
  const current = existing[locale] ?? []
  if (current.some((n) => n === trimmed)) {
    cli.out(`${JSON.stringify(trimmed)} is already listed for ${locale}.`)
    return EXIT_OK
  }
  saveConfig({ properNouns: { ...existing, [locale]: [...current, trimmed] } })
  cli.out(`Added ${JSON.stringify(trimmed)} to the ${locale} proper-noun list.`)
  return EXIT_OK
}

function configGet(cli: Cli, key: string | undefined): void {
  const config = cli.config()
  const secrets = loadSecrets()
  if (key === undefined) {
    for (const k of CONFIG_KEYS) cli.out(`${k} = ${formatConfigValue(k, config[k])}`)
    cli.out(`DEEPL_API_KEY = ${maskSecret(secrets.DEEPL_API_KEY)}`)
    cli.out(`OPENAI_API_KEY = ${maskSecret(secrets.OPENAI_API_KEY)}`)
    return
  }
  if (isConfigKey(key)) {
    cli.out(String(config[key]))
    return
  }
  if (isSecretName(key)) {
    cli.out(maskSecret(secrets[key]))
    return
  }
  throw new UsageError(`Unknown config key "${key}"; expected one of ${CONFIG_KEYS.join(', ')}, DEEPL_API_KEY, OPENAI_API_KEY`)
}

function configSet(cli: Cli, key: string, raw: string): void {
  if (isSecretName(key)) throw new UsageError(`"${key}" is a secret; use: polyglots config set-key ${key}`)
  if (!isConfigKey(key)) throw new UsageError(`Unknown config key "${key}"; expected one of ${CONFIG_KEYS.join(', ')}`)
  const saved = saveConfig({ [key]: coerceConfigValue(key, raw) })
  cli.out(`${key} = ${String(saved[key])}`)
}

async function configSetKey(cli: Cli, rawName: string, value: string | undefined): Promise<number> {
  const name = parseSecretName(rawName)
  const entered = value ?? (await readSecretFromStdin(cli.streams, name))
  if (entered === undefined) {
    cli.err('Cancelled.')
    return EXIT_ERROR
  }
  const secret = entered.trim()
  if (!secret) throw new UsageError(`No value given for ${name}; pass it as an argument or on stdin`)
  saveSecret(name, secret)
  cli.out(`Saved ${name} (${maskSecret(secret)}).`)
  return EXIT_OK
}

function helpConfig(cli: Cli): PolyglotsConfig {
  try {
    return cli.config()
  } catch {
    return DEFAULT_CONFIG
  }
}

function buildProgram(cli: Cli, setExitCode: (code: number) => void): Command {
  const shown = helpConfig(cli)
  const program = new Command()
    .name('polyglots')
    .description('Translate WordPress .po files with machine drafts and AI review. Run without arguments for the interactive menu.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (chunk) => cli.streams.stdout.write(chunk),
      writeErr: (chunk) => cli.streams.stderr.write(chunk),
    })
    .addHelpText('after', '\nExit codes: 0 success, 1 error or aborted, 2 usage error, 3 run stopped early (API quota or rate limit).')

  program
    .command('translate <files...>')
    .description('Translate pending (empty or fuzzy) entries of one or more .po files')
    .option('--all', 'Re-translate every entry, including already-translated ones (asks for confirmation)')
    .option('--dry-run', 'Run the pipeline without writing to the .po files')
    .option('--draft-engine <engine>', `Draft engine: deepl or openai (default: ${shown.defaultDraftEngine})`)
    .option('--locale <locale>', `Target locale (default: ${shown.defaultLocale})`)
    .option('--batch-size <n>', `Entries per draft/review batch (default: ${shown.batchSize})`)
    .option('--model <model>', 'Claude model for the review pass')
    .option('--yes', 'Skip the --all confirmation prompt (required with --all when stdin is not a terminal)')
    .addHelpText(
      'after',
      '\nEnvironment:\n  POLYGLOTS_CLAUDE_BIN  claude executable used for the review pass (default: claude on PATH)\n  POLYGLOTS_HOME        root for config/ and data/ instead of the XDG directories',
    )
    .action(async (files: string[], flags: TranslateFlags) => {
      setExitCode(await runTranslate(cli, files, flags))
    })

  const tm = program.command('tm').description('Translation memory')
  tm.command('import <files...>')
    .description('Import TMX exports into the local translation memory (additive)')
    .option('--locale <locale>', `Target locale to import (default: ${shown.defaultLocale})`)
    .option('--project <name>', 'Tag imported entries with a project name')
    .action(async (patterns: string[], flags: { locale?: string; project?: string }) => {
      const files = expandFileArgs(patterns)
      const locale = parseLocaleArg(flags.locale ?? cli.config().defaultLocale)
      const result = await cli.importTmx(files, {
        locale,
        project: flags.project,
        onProgress: (e) => cli.err(`${e.file}: ${e.entries} entries, ${e.upserted} upserted`),
      })
      cli.out(`Imported ${result.files} file(s): ${result.entries} entries, ${result.upserted} upserted (locale ${locale}).`)
    })

  program
    .command('review <file>')
    .description('Audit a submitted .po and write out only the entries that need work')
    .option('--locale <locale>', `Review locale (default: ${shown.defaultLocale})`)
    .option('--out-dir <dir>', 'Where to write the outputs (default: beside the input)')
    .option('--no-ai', 'Run the deterministic checks only, skipping AI adjudication')
    .option('--batch-size <n>', 'Entries per AI batch')
    .action(async (raw: string, flags: { locale?: string; outDir?: string; ai?: boolean; batchSize?: string }) => {
      const [target] = expandFileArgs([raw])
      const locale = parseLocaleArg(flags.locale ?? cli.config().defaultLocale)
      const report = createReviewProgressReporter(cli.streams.stderr)
      const summary = await cli.reviewFile({
        file: target!,
        locale,
        ...(flags.outDir ? { outDir: flags.outDir } : {}),
        ...(flags.ai === false ? { noAi: true } : {}),
        ...(flags.batchSize ? { batchSize: parsePositiveInt('--batch-size', flags.batchSize) } : {}),
        claudeBin: process.env.POLYGLOTS_CLAUDE_BIN || undefined,
        onProgress: report,
      }).finally(() => report.finish())
      cli.out(
        `Reviewed ${summary.reviewed} entries (${summary.skipped} not submitted): ` +
          `${summary.problems} flagged, ${summary.approvable} approvable.`,
      )
      if (summary.needsReview > 0) {
        cli.out(`${summary.needsReview} entries need your eye; see the report. Re-run without --no-ai to have them adjudicated.`)
      }
      if (summary.unreviewed > 0) cli.out(`${summary.unreviewed} entries could not be reviewed and were flagged.`)
      if (summary.problemsFile) cli.out(`Problems: ${summary.problemsFile}`)
      else if (summary.needsReview === 0) cli.out('Nothing flagged; the whole submission looks approvable.')
      cli.out(`Report:   ${summary.reportFile}`)
    })

  const glossary = program.command('glossary').description('translate.wordpress.org glossary cache')
  glossary
    .command('sync')
    .description('Download the WordPress.org glossary for a locale into the local cache')
    .option('--locale <locale>', `Glossary locale (default: ${shown.defaultLocale})`)
    .action(async (flags: { locale?: string }) => {
      const locale = parseLocaleArg(flags.locale ?? cli.config().defaultLocale)
      const result = await cli.syncGlossary({ locale })
      cli.out(`Synced ${result.entries} glossary entries for ${locale}.`)
    })
  glossary
    .command('export [file]')
    .description('Write the cached glossary as a Poedit-compatible CSV (stdout when no file is given)')
    .option('--locale <locale>', `Glossary locale (default: ${shown.defaultLocale})`)
    .option('--delimiter <char>', 'Column separator, ";" or "," (default: ;)')
    .action(async (file: string | undefined, flags: { locale?: string; delimiter?: string }) => {
      const locale = parseLocaleArg(flags.locale ?? cli.config().defaultLocale)
      const delimiter = parseCsvDelimiter(flags.delimiter ?? ';')
      const result = await cli.exportGlossary({ locale, file, delimiter })
      if (result.file) cli.out(`Exported ${result.entries} glossary terms (${locale}) to ${result.file}`)
      else cli.streams.stdout.write(result.csv)
    })

  const cfg = program.command('config').description('Settings and API keys')
  cfg
    .command('get [key]')
    .description('Show a setting, or all settings (API keys are masked)')
    .action((key?: string) => configGet(cli, key))
  cfg
    .command('set <key> <value>')
    .description(`Change a setting (${CONFIG_KEYS.join(', ')})`)
    .action((key: string, value: string) => configSet(cli, key, value))
  cfg
    .command('add-name <name>')
    .description('Add a proper noun the title-case check should never flag (places, people, institutions)')
    .option('--locale <locale>', `Locale the name belongs to (default: ${shown.defaultLocale})`)
    .action((name: string, flags: { locale?: string }) => {
      const locale = parseLocaleArg(flags.locale ?? cli.config().defaultLocale)
      setExitCode(configAddName(cli, name, locale))
    })
  cfg
    .command('set-key <name> [value]')
    .description('Store DEEPL_API_KEY or OPENAI_API_KEY; omit the value to read it from stdin')
    .action(async (name: string, value?: string) => {
      setExitCode(await configSetKey(cli, name, value))
    })

  return program
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function exitCodeFor(cli: Cli, error: unknown): number {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? EXIT_OK : EXIT_USAGE
  }
  if (error instanceof UsageError) {
    cli.err(`Error: ${error.message}`)
    return EXIT_USAGE
  }
  cli.err(`Error: ${errorMessage(error)}`)
  return EXIT_ERROR
}

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const cli = createCli(deps)
  let exitCode = EXIT_OK
  try {
    if (argv.length === 0) {
      await cli.runTui()
      return EXIT_OK
    }
    await buildProgram(cli, (code) => (exitCode = code)).parseAsync(argv, { from: 'user' })
    return exitCode
  } catch (error) {
    return exitCodeFor(cli, error)
  }
}

function isEntryPoint(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2))
