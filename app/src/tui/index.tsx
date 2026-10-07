import { render, type RenderOptions } from 'ink'
import { App } from './App.js'
import { defaultCommands, type TuiCommands } from './commands.js'
import { createActivity, type Activity } from './hooks/activity.js'
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
  // For tests: a run already in flight, and a shorter wait on the stats
  // server's close than the two seconds a person gets.
  activity?: Activity
  closeTimeoutMs?: number
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

  const activity = opts.activity ?? createActivity()
  const services = createServices()
  const stderr = opts.stderr ?? process.stderr
  const instance = render(<App commands={commands} cwd={cwd} activity={activity} services={services} />, renderOptions)
  try {
    await instance.waitUntilExit()
  } catch (err) {
    const trace = `\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
    // A render crash with a run still going would leave that run writing
    // files from a process with no UI, so this is the same hard exit as an
    // abandoned quit, with the trace written where it can be read.
    if (activity.busy) {
      await writeOut(stderr, `${trace}\nInterrupted; abandoning the run in progress.\n`)
      exit(EXIT_INTERRUPTED)
      throw err
    }
    // A stats server that will not close keeps Node alive behind the
    // rethrown error as surely as after a clean quit, so the error is
    // printed here and the process ends with it.
    if ((await closeServices(services, opts.closeTimeoutMs)) === 'timeout') {
      await writeOut(stderr, trace)
      exit(1)
    }
    throw err
  }

  // Before anything else: a listening server would keep Node alive after the
  // UI is gone, with nothing on screen to say why the shell has not come back.
  const closed = await closeServices(services, opts.closeTimeoutMs)

  // Printed after the alternate screen is gone, onto the screen the person
  // returns to, which is the only place it survives.
  const stdout = opts.stdout ?? process.stdout
  if (services.lastOutput !== undefined && exitSummaryWanted(commands ?? defaultCommands)) {
    await writeOut(stdout, `Last output: ${services.lastOutput}\n`)
  }

  // A translate/import/sync still in flight would keep the process alive and
  // keep writing files with no UI. The quit prompt already asked; exit hard.
  if (activity.busy) {
    await writeOut(stderr, '\nInterrupted; abandoning the run in progress.\n')
    exit(EXIT_INTERRUPTED)
    return
  }
  // The server did not close in time, so its socket would hold the process
  // open past the restored terminal. Nothing else is left to finish.
  if (closed === 'timeout') exit(0)
}

// Resolves once the stream has taken the text. On a pipe the write is
// asynchronous, and exiting straight after it can cut off the very line
// that was written to survive the exit.
function writeOut(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => resolve())
  })
}

function exitSummaryWanted(commands: TuiCommands): boolean {
  try {
    return commands.loadTuiState().settings.exitSummary
  } catch {
    return true
  }
}
