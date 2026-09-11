import { createHash } from 'node:crypto'
import type { GlossaryEntry, Locale } from '../types.js'
import { buildAuditPrompt } from './prompt.js'
import { REPAIRABLE_RULES } from './repair.js'
import { profileFor } from './rules/profiles.js'

// A long review is hours of `claude -p` calls. The marker records how far one got
// so an interrupted run can pick up rather than start over, and it lives in the
// problems file's own header because that file is the only artifact of the run.
export const MARKER_HEADER = 'X-Polyglots-Review'

// Bumped when `repaired` became a required field, so old markers are rejected
// on purpose rather than by accident of validation.
const FORMAT = 2

// Kept as named parts rather than one hash so a refusal can say what moved. The
// user's next step differs: a changed submission means the input was replaced, a
// changed glossary only means the verdicts would no longer agree.
export interface Fingerprint {
  source: string
  glossary: string
  rules: string
  batchSize: number
  ai: boolean
}

export interface ReviewMarker {
  fingerprint: Fingerprint
  // Batches finished, and how many there were. Everything before `done` is
  // already decided and persisted; the batch that was interrupted is not.
  done: number
  of: number
  // What those batches decided, so a resumed run can report a summary covering
  // the whole submission rather than only the part it ran itself.
  problems: number
  unreviewed: number
  // Entries the skipped batches repaired. Their text is in the file, but the
  // count is not recoverable from it, so it rides along here.
  repaired: number
  byRule: Record<string, number>
}

export function encodeMarker(marker: ReviewMarker): string {
  return JSON.stringify({ v: FORMAT, ...marker })
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTally(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((n) => isCount(n))
  )
}

const HASH_LENGTH = 16

function isFingerprint(value: unknown): value is Fingerprint {
  if (typeof value !== 'object' || value === null) return false
  const { source, glossary, rules, batchSize, ai } = value as Record<string, unknown>
  const hashes = [source, glossary, rules]
  return (
    hashes.every((h) => typeof h === 'string' && h.length === HASH_LENGTH) && isCount(batchSize) && typeof ai === 'boolean'
  )
}

// A hand-edited, truncated or future-format marker reads as no marker at all.
// Resuming from a number we guessed at would silently skip unreviewed entries.
export function decodeMarker(value: string | undefined): ReviewMarker | undefined {
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { v, fingerprint, done, of, problems, unreviewed, repaired, byRule } = parsed as Record<string, unknown>
  if (v !== FORMAT) return undefined
  if (!isFingerprint(fingerprint)) return undefined
  if (!isCount(done) || !isCount(of) || !isCount(problems) || !isCount(unreviewed)) return undefined
  if (!isCount(repaired)) return undefined
  if (!isTally(byRule)) return undefined
  const { source, glossary, rules, batchSize, ai } = fingerprint
  return { fingerprint: { source, glossary, rules, batchSize, ai }, done, of, problems, unreviewed, repaired, byRule }
}

export interface FingerprintInput {
  source: string
  locale: Locale
  batchSize: number
  noAi: boolean
  glossary: GlossaryEntry[]
  properNouns: string[]
}

// Written as escapes, not literal control bytes, so the file stays text to git and grep.
const UNIT = '\u0000'
const FIELD = '\u0001'
const PART = '\u0002'

function hash(...parts: string[]): string {
  return createHash('sha256').update(parts.join(PART)).digest('hex').slice(0, HASH_LENGTH)
}

// Everything that decides what a batch contains and how it is judged. If any of
// it moved, the earlier batches answered a different question and their verdicts
// cannot be mixed with new ones, so resuming is refused rather than approximated.
export function fingerprintReview(input: FingerprintInput): Fingerprint {
  const profile = profileFor(input.locale)
  return {
    source: hash(input.source),
    glossary: hash(
      ...input.glossary.map((g) => [g.sourceTerm, g.translation, g.partOfSpeech ?? ''].join(FIELD)).sort(),
    ),
    rules: hash(
      input.locale,
      String(profile.glossaryStemRatio),
      [...profile.rules].sort().join(','),
      [...input.properNouns].sort().join(UNIT),
      // What the rules repair on their own. Widening the set changes the verdicts
      // the earlier batches would have reached, so it has to refuse a resume.
      [...REPAIRABLE_RULES].join(','),
      // The guidance itself, so editing the prompt invalidates a resume without
      // anyone having to remember to bump a version number.
      buildAuditPrompt([], input.locale, 2),
    ),
    batchSize: input.batchSize,
    ai: !input.noAi,
  }
}

// One reason, not a list: the first difference is already enough to refuse, and
// enumerating the rest buries it.
export function describeMismatch(saved: Fingerprint, current: Fingerprint): string | undefined {
  if (saved.source !== current.source) return 'the submission file has changed since'
  if (saved.batchSize !== current.batchSize) {
    return `the batch size has changed since (${saved.batchSize} then, ${current.batchSize} now)`
  }
  if (saved.ai !== current.ai) {
    return saved.ai ? 'that run used the AI reviewer and this one does not' : 'that run skipped the AI reviewer'
  }
  if (saved.glossary !== current.glossary) return 'the glossary has changed since'
  if (saved.rules !== current.rules) return 'the locale rules or review guidance have changed since'
  return undefined
}
