import { render, type RenderOptions } from 'ink'
import { App } from './App.js'
import type { TuiCommands } from './commands.js'
import { createActivity } from './hooks/activity.js'

export const EXIT_INTERRUPTED = 130

export interface RunTuiOptions {
  isTTY?: boolean
  exit?: (code: number) => void
  stdin?: RenderOptions['stdin']
  stdout?: RenderOptions['stdout']
  stderr?: RenderOptions['stderr']
  patchConsole?: boolean
  interactive?: boolean
  commands?: TuiCommands
  cwd?: string
}

export async function runTui(opts: RunTuiOptions = {}): Promise<void> {
  const { isTTY = Boolean(process.stdin.isTTY), exit = process.exit, commands, cwd } = opts
  if (!isTTY) {
    throw new Error('The interactive menu needs a terminal; run a subcommand instead (see polyglots --help).')
  }
  const renderOptions: RenderOptions = {}
  if (opts.stdin) renderOptions.stdin = opts.stdin
  if (opts.stdout) renderOptions.stdout = opts.stdout
  if (opts.stderr) renderOptions.stderr = opts.stderr
  if (opts.patchConsole !== undefined) renderOptions.patchConsole = opts.patchConsole
  if (opts.interactive !== undefined) renderOptions.interactive = opts.interactive

  const activity = createActivity()
  const instance = render(<App commands={commands} cwd={cwd} activity={activity} />, renderOptions)
  await instance.waitUntilExit()

  // Ctrl+C only unmounts ink; a translate/import/sync still in flight would keep the
  // process alive and keep writing files with no UI. Exit hard instead.
  if (activity.busy) {
    const stderr = opts.stderr ?? process.stderr
    stderr.write('\nInterrupted; abandoning the run in progress.\n')
    exit(EXIT_INTERRUPTED)
  }
}
