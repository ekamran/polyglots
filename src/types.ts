export type Locale = string

export interface TranslationUnit {
  key: string
  msgid: string
  msgctxt?: string
  msgidPlural?: string
  comments: string[]
  references: string[]
}

export interface DraftResult {
  key: string
  drafts: string[]
}

export interface DraftEngine {
  readonly name: 'deepl' | 'openai'
  translate(units: TranslationUnit[], locale: Locale, nplurals: number): Promise<DraftResult[]>
}

export interface ReviewInput {
  key: string
  msgid: string
  msgctxt?: string
  msgidPlural?: string
  comments: string[]
  drafts: string[]
}

export interface ReviewResult {
  key: string
  text: string[]
  fuzzy: boolean
  reason: string
}

export interface TmEntry {
  source: string
  target: string
  locale: Locale
  context?: string
  project?: string
}

export interface TmMatch extends TmEntry {
  score: number
}

export interface GlossaryEntry {
  locale: Locale
  sourceTerm: string
  translation: string
  partOfSpeech?: string
  notes?: string
}

export interface AuditEntry extends TranslationUnit {
  msgstr: string[]
  fuzzy: boolean
}

export type Severity = 'error' | 'suspect'

export interface Finding {
  rule: string
  severity: Severity
  message: string
}

export interface ReviewSummary {
  file: string
  total: number
  skipped: number
  reviewed: number
  problems: number
  // Soft findings nothing adjudicated, only possible under --no-ai: reported for
  // a human to glance at rather than written into the problems file.
  needsReview: number
  approvable: number
  unreviewed: number
  // Entries in batches the run never attempted, because it was stopped part way.
  // Kept apart from `unreviewed`, which means a batch that was attempted and
  // failed, and excluded from `approvable`: nothing looked at these, so nothing
  // may invite the user to bulk-approve them.
  pending: number
  // Entries that carry a correction, whether the rules or the model made it. The
  // rest still need a human to write something.
  repaired: number
  // How many entries the output file holds. Reported rather than derived, because
  // `problems - repaired` is not it: an entry whose only fault was whitespace is
  // written out too, and it counts as neither a problem nor a soft finding.
  written: number
  byRule: Record<string, number>
  problemsFile?: string
}

export type ReviewEvent =
  // Resume is per entry and lives in the job store, so a resumed run simply has
  // fewer entries to batch. There is no count of inherited batches to carry: the
  // bar counts from zero out of however many batches are left.
  | { type: 'start'; file: string; total: number; reviewable: number }
  | { type: 'rules-done'; flagged: number; suspects: number }
  // `at` lets a pure reducer measure how long each batch took, which is what the
  // remaining-time estimate is built from.
  | { type: 'batch-start'; index: number; of: number; size: number; at: number }
  | { type: 'batch-done'; index: number; problems: number; at: number }
  | { type: 'batch-failed'; index: number; size: number; reason: string; at: number }
  | { type: 'written'; file: string }
  // Emitted when the output file from a previous run still carries the
  // FORMAT=2-era marker: nothing reads it back any more, so the run is
  // starting from the top and this is the only way anyone would know.
  | { type: 'marker-ignored'; file: string }
  // Emitted by whichever surface owns the keyboard, not by the run itself, so a
  // progress line can say it is parked rather than wedged.
  | { type: 'paused'; at: number }
  | { type: 'resumed'; at: number }
  | { type: 'done'; summary: ReviewSummary }

export type ConsistencyScope = 'core' | 'all'

export interface ConsistencyEntry {
  translation: string
  count: number
}

export interface PolyglotsConfig {
  defaultLocale: Locale
  defaultDraftEngine: 'deepl' | 'openai'
  batchSize: number
  consistencyTtlDays: number
  // Per-locale names the built-in lists cannot cover (places, people,
  // institutions, historical events). Entries may be multi-word.
  properNouns: Record<string, string[]>
}

export interface Secrets {
  DEEPL_API_KEY?: string
  OPENAI_API_KEY?: string
}
