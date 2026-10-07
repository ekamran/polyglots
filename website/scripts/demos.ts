import type { CliDeps } from '../../app/src/cli.js'
import type { Resolution, Fetched } from '../../app/src/commands/fetch.js'
import type { TranslateEvent, TranslateSummary } from '../../app/src/commands/translate.js'
import type { StatsSummary } from '../../app/src/commands/stats.js'
import type { ReviewEvent, ReviewSummary } from '../../app/src/types.js'

// The scenarios the site's terminal panels play. Each is a real command line,
// run through the real cli.ts with only the slow, networked part swapped out:
// the review, the translation, the download. Everything the person sees around
// that part (header, progress line, summary box, requester message) is the
// CLI's own code, so the panels change when the CLI does.
//
// Every project, file and number here is invented. The panels are public, and
// a real submission would put a real contributor's work on show.

export interface Clock {
  /** Moves demo time on by `ms` (what the run would really take) and sets how long the panel lingers on the frame the next write makes. */
  advance(ms: number, linger: number): void
  now(): number
}

export interface Scenario {
  name: string
  argv: string[]
  /** Files the command insists exist before it starts. Created empty. */
  files?: string[]
  /** Settings to write to config.json first. */
  config?: Record<string, unknown>
  deps(clock: Clock): CliDeps
}

const PLUGIN_FILE = 'wp-plugins-lunar-forms-stable-tr.po'
const THEME_FILE = 'wp-themes-harbor-tr.po'

// Typed in full, so a field added to ReviewSummary breaks the snapshot's
// typecheck here rather than printing `undefined` on the site.
const reviewSummary = (file: string): ReviewSummary => ({
  file,
  locale: 'tr',
  total: 412,
  skipped: 126,
  reviewed: 286,
  problems: 22,
  needsReview: 0,
  approvable: 264,
  unreviewed: 0,
  pending: 0,
  repaired: 21,
  written: 23,
  byRule: { glossary: 9, 'title-case': 4, placeholder: 2, punctuation: 3 },
  byGroup: { glossary: 9, meaning: 6, 'title-case': 4, other: 2 },
  problemsFile: file.replace(/\.po$/, '-repaired.po'),
})

const FLAGGED_PER_BATCH = [3, 1, 4, 0, 2, 5, 1, 3, 2, 1]

function playReview(clock: Clock, emit: (e: ReviewEvent) => void, file: string): ReviewSummary {
  const summary = reviewSummary(file)
  emit({ type: 'start', file, total: summary.total, reviewable: summary.reviewed })
  clock.advance(1_800, 700)
  emit({ type: 'rules-done', flagged: 17, suspects: 41, memoryApproved: 38, memoryRepaired: 4 })
  const of = FLAGGED_PER_BATCH.length
  FLAGGED_PER_BATCH.forEach((problems, i) => {
    const index = i + 1
    clock.advance(400, 350)
    emit({ type: 'batch-start', index, of, size: index === of ? 19 : 25, at: clock.now() })
    clock.advance(31_000 + ((i * 7_919) % 9_000), 420)
    emit({ type: 'batch-done', index, problems, at: clock.now() })
  })
  clock.advance(300, 500)
  emit({ type: 'written', file: summary.problemsFile! })
  return summary
}

export const review: Scenario = {
  name: 'review',
  argv: ['review', PLUGIN_FILE],
  files: [PLUGIN_FILE],
  // Set so the requester message carries the link it carries for a reviewer
  // who has set theirs, which is how the message is meant to be used.
  config: { wporgUsername: 'your-wporg-name' },
  deps: (clock) => ({
    reviewFile: async (opts) => playReview(clock, (e) => opts.onProgress?.(e), opts.file),
  }),
}

export const translate: Scenario = {
  name: 'translate',
  argv: ['translate', THEME_FILE],
  files: [THEME_FILE],
  deps: (clock) => ({
    translate: async (opts) => {
      const emit = (e: TranslateEvent) => opts.onProgress?.(e)
      const sizes = [25, 25, 12]
      const fuzzy = [2, 1, 2]
      const summary: TranslateSummary = { file: opts.file, total: 318, pending: 74, fromTm: 12, translated: 62, fuzzy: 5, skipped: 0 }
      emit({ type: 'start', file: opts.file, total: summary.total, pending: summary.pending })
      clock.advance(900, 600)
      emit({ type: 'tm-hit', count: summary.fromTm })
      sizes.forEach((size, i) => {
        const index = i + 1
        clock.advance(300, 300)
        emit({ type: 'batch-start', index, of: sizes.length, size, at: clock.now() })
        emit({ type: 'batch-phase', index, phase: 'drafting', at: clock.now() })
        clock.advance(4_000, 700)
        emit({ type: 'batch-phase', index, phase: 'reviewing', at: clock.now() })
        clock.advance(28_000, 900)
        emit({ type: 'batch-done', index, translated: size, fuzzy: fuzzy[i]!, at: clock.now() })
      })
      emit({ type: 'saved' })
      emit({ type: 'done', summary })
      return summary
    },
  }),
}

export const fetch: Scenario = {
  name: 'fetch',
  // A literal ~ rather than an expanded path: it is what the person would
  // type, and the downloads are faked, so nothing is written there.
  argv: ['fetch', '--get', 'waiting', '--out-dir', '~/Downloads/polyglots', 'lunar-forms', 'harbor', 'quiet-gallery'],
  config: { wporgUsername: 'your-wporg-name' },
  deps: (clock) => ({
    resolveProjects: async (refs) => {
      clock.advance(4_500, 900)
      return refs.map((ref): Resolution => {
        if (ref.slug === 'lunar-forms') return { input: ref.slug, state: 'ready', type: 'wp-plugins', slug: 'lunar-forms', branch: 'stable', count: 286 }
        if (ref.slug === 'harbor') return { input: ref.slug, state: 'ready', type: 'wp-themes', slug: 'harbor', count: 41 }
        return { input: ref.slug, state: 'empty', reason: 'nothing waiting' }
      })
    },
    fetchProjects: async (ready) => {
      clock.advance(7_000, 900)
      return ready.map((r): Fetched => ({
        input: r.input,
        state: 'fetched',
        file: r.type === 'wp-themes' ? `wp-themes-${r.slug}-tr.po` : `wp-plugins-${r.slug}-${r.branch}-tr.po`,
      }))
    },
    reviewFile: async (opts) => {
      clock.advance(60_000, 1_100)
      if (opts.file.startsWith('wp-themes-')) {
        // Nothing flagged, so nothing written: the real run sets no
        // problemsFile then, and the table must not claim a file it lacks.
        const { problemsFile: _none, ...clean } = reviewSummary(opts.file)
        return { ...clean, total: 64, skipped: 23, reviewed: 41, problems: 0, approvable: 41, repaired: 0, written: 0, byRule: {}, byGroup: {} }
      }
      return reviewSummary(opts.file)
    },
  }),
}

// A summary with a few months behind it, enough for the sparkline to have a
// shape. Project names are invented.
export const stats: Scenario = {
  name: 'stats',
  argv: ['stats'],
  deps: (clock) => ({
    writeStats: async (): Promise<StatsSummary> => {
      clock.advance(400, 300)
      return {
        file: 'polyglots-stats.html',
        submissions: 148,
        entries: 21_734,
        incomplete: 2,
        translateRuns: 37,
        translateEntries: 4_912,
        flagged: 2_391,
        weeks: [310, 420, 380, 520, 610, 480, 700, 655, 590, 810, 760, 905],
        topProjects: [
          { project: 'lunar-forms', runs: 9, entries: 2_870, flagged: 344 },
          { project: 'harbor', runs: 6, entries: 1_402, flagged: 98 },
          { project: 'quiet-gallery', runs: 4, entries: 966, flagged: 151 },
        ],
      }
    },
  }),
}

export const SCENARIOS: readonly Scenario[] = [review, translate, fetch, stats]
