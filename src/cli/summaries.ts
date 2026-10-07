import type { TranslateSummary } from '../commands/translate.js'
import { box, table } from '../ui/layout.js'
import { nextLine } from '../ui/messages.js'
import type { Painter } from '../ui/paint.js'

// Each command's closing block, as pure functions of a painter and a summary.
// Kept out of cli.ts so they can be tested with colour forced on and off
// without running a command, and so the TUI can reuse the wording later.

export function translateSummary(p: Painter, s: TranslateSummary, dryRun: boolean): string[] {
  const title = s.stopped
    ? `${p.paint('warn', p.glyphs.warn)} Stopped`
    : dryRun
      ? `${p.paint('accent', p.glyphs.bullet)} Dry run`
      : `${p.paint('success', p.glyphs.ok)} Done`
  const rows = table(
    [
      ['translated', String(s.translated)],
      ['from TM', String(s.fromTm)],
      ['fuzzy', s.fuzzy > 0 ? p.paint('warn', String(s.fuzzy)) : '0', s.fuzzy > 0 ? p.paint('muted', 'check before upload') : ''],
      ['skipped', String(s.skipped)],
    ],
    { align: ['left', 'right', 'left'] },
  )
  const next =
    dryRun ? 'Nothing was written.'
    : s.stopped ? 'Re-run the same command to resume.'
    : `Open ${p.paint('path', s.file)} in PoEdit to review.`
  return [...box(p, title, rows), nextLine(p, next)]
}
