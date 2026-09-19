import { spawn } from 'node:child_process'

export interface OpenCommand {
  command: string
  args: string[]
}

/**
 * The launcher that hands a file to whatever the desktop associates with it.
 *
 * One per platform, with no fallbacks: unlike the clipboard, every desktop
 * ships exactly one of these, and a second candidate would only be a slower way
 * to fail.
 */
export function openCommand(platform: NodeJS.Platform): OpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [] }
  // `start` is a cmd builtin rather than a program, so it cannot be spawned
  // directly. Its first quoted argument is the window title, and leaving the
  // empty string out makes Windows read the file path as the title and open
  // nothing at all.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''] }
  return { command: 'xdg-open', args: [] }
}

export type Launcher = (command: string, args: string[]) => boolean

// Detached and unreferenced, so the editor outlives this process and the TUI
// does not sit blocked while a large .po loads. That costs the exit status: a
// launcher which fails after starting reports asynchronously, and the only
// honest signal left is that the application did not appear. The alternative is
// waiting on a GUI application to close, which is worse.
//
// The error listener is not optional. Without one, a missing launcher raises an
// unhandled 'error' event and takes the whole TUI down with it.
function spawnDetached(command: string, args: string[]): boolean {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
  return true
}

export interface OpenOptions {
  platform?: NodeJS.Platform
  launch?: Launcher
}

/**
 * Opens a path in whatever application the desktop associates with it.
 *
 * Never throws. The caller is a results screen already showing the path, so a
 * launcher that is missing costs a copy and paste rather than the run's output.
 */
export function openInDefaultApp(target: string, opts: OpenOptions = {}): boolean {
  const { command, args } = openCommand(opts.platform ?? process.platform)
  const launch = opts.launch ?? spawnDetached
  try {
    return launch(command, [...args, target])
  } catch {
    return false
  }
}
