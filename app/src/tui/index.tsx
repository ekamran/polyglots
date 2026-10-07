import { render, type RenderOptions } from 'ink'
import { App } from './App.js'
import { defaultCommands, type TuiCommands } from './commands.js'
import { createActivity } from './hooks/activity.js'
import { closeServices, createServices } from './services.js'

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
  // The alternate screen is Ink's own, including its teardown: Ink registers
  // a signal-exit hook that unmounts, and unmounting leaves the alternate
  // screen, so SIGTERM, SIGINT and an exit from anywhere give the terminal
  // back. Ctrl+C is the frame's to handle, not Ink's, because quitting during
  // a run asks first.
  const renderOptions: RenderOptions = { alternateScreen: true, exitOnCtrlC: false }
  if (opts.stdin) renderOptions.stdin = opts.stdin
  if (opts.stdout) renderOptions.stdout = opts.stdout
  if (opts.stderr) renderOptions.stderr = opts.stderr
  if (opts.patchConsole !== undefined) renderOptions.patchConsole = opts.patchConsole
  if (opts.interactive !== undefined) renderOptions.interactive = opts.interactive

  const activity = createActivity()
  const services = createServices()
  const instance = render(<App commands={commands} cwd={cwd} activity={activity} services={services} />, renderOptions)
  try {
    await instance.waitUntilExit()
  } finally {
    // Before anything else, and on the error path too: a listening server
    // would keep Node alive after the UI is gone, with nothing on screen to
    // say why the shell has not come back.
    await closeServices(services)
  }

  // Printed after the alternate screen is gone, onto the screen the person
  // returns to, which is the only place it survives.
  const stdout = opts.stdout ?? process.stdout
  if (services.lastOutput !== undefined && exitSummaryWanted(commands ?? defaultCommands)) {
    stdout.write(`Last output: ${services.lastOutput}\n`)
  }

  // A translate/import/sync still in flight would keep the process alive and
  // keep writing files with no UI. The quit prompt already asked; exit hard.
  if (activity.busy) {
    const stderr = opts.stderr ?? process.stderr
    stderr.write('\nInterrupted; abandoning the run in progress.\n')
    exit(EXIT_INTERRUPTED)
  }
}

function exitSummaryWanted(commands: TuiCommands): boolean {
  try {
    return commands.loadTuiState().settings.exitSummary
  } catch {
    return true
  }
}
