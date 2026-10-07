import type { TranslateSummary } from '../commands/translate.js'
import type { ReviewSummary } from '../types.js'
import type { Tally } from '../commands/fetch-report.js'
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

export function reviewSummary(p: Painter, s: ReviewSummary, requesterMessage: string | undefined): string[] {
  // Undecided entries are written beside decided ones, so flagged is both.
  const flagged = s.problems + s.needsReview
  const stopped = s.pending > 0
  const title = stopped ? `${p.paint('warn', p.glyphs.warn)} Stopped early` : `${p.paint('success', p.glyphs.ok)} Reviewed`
  const rows: string[][] = [
    ['reviewed', String(s.reviewed), p.paint('muted', `${s.skipped} not submitted`)],
    ['flagged', flagged > 0 ? p.paint('warn', String(flagged)) : '0', ''],
    ['approvable', p.paint('success', String(s.approvable)), ''],
  ]
  if (s.needsReview > 0) rows.push(['guesses', String(s.needsReview), p.paint('muted', 're-run without --no-ai to decide them')])
  if (s.unreviewed > 0) rows.push(['unreviewed', p.paint('warn', String(s.unreviewed)), p.paint('muted', 'could not be reviewed; flagged')])
  if (stopped) rows.push(['not reached', p.paint('warn', String(s.pending)), ''])
  // written - repaired, not flagged - repaired: a whitespace-only fix is neither
  // a problem nor a needsReview entry, so flagged - repaired can go negative.
  if (s.repaired > 0) rows.push(['repaired', String(s.repaired), p.paint('muted', `${s.written - s.repaired} left for you`)])
  const out = box(p, title, table(rows, { align: ['left', 'right', 'left'] }))
  if (requesterMessage) out.push('', p.paint('heading', 'Message for the requester:'), requesterMessage, '')
  // A stopped run that found something says both: the file holds what was
  // found so far, and the rest still needs a run. Only a run that reached the
  // end may call the rest approvable, since a stopped one has entries nothing
  // has looked at.
  if (s.problemsFile) out.push(nextLine(p, `Wrote ${p.paint('path', s.problemsFile)}`))
  if (stopped) out.push(nextLine(p, 'Re-run the same command to carry on.'))
  else if (!s.problemsFile) out.push(nextLine(p, 'Nothing flagged; the whole submission looks approvable.'))
  return out
}

// A project's outcome word, coloured by how it ended. Skipped is muted rather
// than a warning: a project with nothing waiting is a normal answer.
export function tallyCell(p: Painter, tally: string): string {
  if (tally === 'done') return p.paint('success', tally)
  if (tally === 'failed') return p.paint('error', tally)
  if (tally === 'stopped') return p.paint('warn', tally)
  return p.paint('muted', tally)
}

// Titled by the worst outcome, since that is the one needing action.
export function fetchTally(p: Painter, t: Tally): string[] {
  const title =
    t.failed > 0 ? `${p.paint('error', p.glyphs.fail)} Fetched with failures`
    : t.stopped > 0 ? `${p.paint('warn', p.glyphs.warn)} Stopped`
    : `${p.paint('success', p.glyphs.ok)} Fetched`
  const rows = table(
    [['done', String(t.done)], ['failed', String(t.failed)], ['skipped', String(t.skipped)], ...(t.stopped > 0 ? [['stopped', String(t.stopped)]] : [])],
    { align: ['left', 'right'] },
  )
  const out = box(p, title, rows)
  if (t.stopped > 0) out.push(nextLine(p, 'Run the same list again to carry on.'))
  return out
}
