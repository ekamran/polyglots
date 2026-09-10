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
  byRule: Record<string, number>
  problemsFile?: string
  reportFile: string
}

export type ReviewEvent =
  | { type: 'start'; file: string; total: number; reviewable: number }
  | { type: 'rules-done'; flagged: number; suspects: number }
  | { type: 'batch-start'; index: number; of: number; size: number }
  | { type: 'batch-done'; index: number; problems: number }
  | { type: 'batch-failed'; index: number; size: number; reason: string }
  | { type: 'written'; file: string }
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
