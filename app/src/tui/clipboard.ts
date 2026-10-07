import { spawnSync } from 'node:child_process'

export interface ClipboardCommand {
  command: string
  args: string[]
}

/**
 * The helpers worth trying on a platform, in the order to try them.
 *
 * macOS and Windows ship exactly one, so there is nothing to fall through to.
 * Everything else is treated as Linux-like, where Wayland leads: if wl-copy is
 * present the session is almost certainly Wayland, and xclip may still be
 * installed while writing to an X clipboard nothing there reads.
 */
export function clipboardCommands(platform: NodeJS.Platform): ClipboardCommand[] {
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }]
  if (platform === 'win32') return [{ command: 'clip', args: [] }]
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ]
}

export type ClipboardRunner = (command: string, args: string[], input: string) => boolean

// Synchronous on purpose. The whole operation is a pipe into a tiny helper, and
// making it async would add a pending state to a results screen for something
// that finishes before the next frame.
function spawnCopy(command: string, args: string[], input: string): boolean {
  const result = spawnSync(command, args, { input })
  return result.error === undefined && result.status === 0
}

export interface CopyOptions {
  platform?: NodeJS.Platform
  run?: ClipboardRunner
}

/**
 * Puts text on the system clipboard, reporting whether it worked.
 *
 * Never throws. A missing helper, a sandbox that blocks spawning, a headless
 * box with no clipboard at all: each is an ordinary false. The caller is a
 * results screen that is already showing the text, so a failed copy costs a
 * keystroke, while an exception would cost the run's output.
 */
export function copyToClipboard(text: string, opts: CopyOptions = {}): boolean {
  const platform = opts.platform ?? process.platform
  const run = opts.run ?? spawnCopy
  for (const { command, args } of clipboardCommands(platform)) {
    try {
      if (run(command, args, text)) return true
    } catch {
      // Try the next one; a helper that blows up is no different from one that
      // is not installed.
    }
  }
  return false
}
