import { createHash } from 'node:crypto'
import { fingerprintReview } from '../audit/resume.js'
import { buildReviewPrompt } from '../review/prompt.js'
import type { AuditEntry, GlossaryEntry, Locale } from '../types.js'

const HASH_LENGTH = 16

// Written as escapes, not literal control bytes, so the file stays text to git
// and grep. Same convention as resume.ts.
const FIELD = ''
const PART = ''

function hash(...parts: string[]): string {
  return createHash('sha256').update(parts.join(PART)).digest('hex').slice(0, HASH_LENGTH)
}

// What the entry says, and nothing about how it is judged. Comments are left
// out: a translator note changes neither the source nor the translation, and
// including it would invalidate a verdict over an edit to a code comment.
export function srcHash(entry: AuditEntry): string {
  return hash(entry.msgid, entry.msgctxt ?? '', entry.msgidPlural ?? '', entry.msgstr.join(FIELD))
}

export interface ConfigHashInput {
  locale: Locale
  glossary: GlossaryEntry[]
  properNouns: string[]
}

// Everything about *how* we ask, so that changing any of it invalidates every
// cached verdict at once. Deliberately coarse: a finer scheme that invalidated
// only the entries a glossary edit could affect was designed and discarded,
// because rules and glossary change while developing this tool rather than
// during a review, and starting over is the wanted behaviour when they do.
//
// fingerprintReview already hashes the glossary, and hashes the rule profile
// together with the prompt template, which is exactly the split needed here.
// The source and batch size it also returns are deliberately not used: the
// source is per entry now, and batch size cannot change a verdict.
export function configHash(input: ConfigHashInput): string {
  const fingerprint = fingerprintReview({
    source: '',
    locale: input.locale,
    batchSize: 0,
    noAi: false,
    glossary: input.glossary,
    properNouns: input.properNouns,
  })
  return hash(fingerprint.glossary, fingerprint.rules)
}

// Translate's equivalent, and deliberately narrower: it runs no rules, and its
// prompt does not inline glossary terms, so the only thing that can invalidate
// a draft review is the prompt itself. Kept as its own function rather than a
// flag on configHash, because the two produce different values and the tables
// they key are pruned separately.
export function translateConfigHash(locale: Locale): string {
  return hash(buildReviewPrompt([], locale, 2))
}

export function draftHash(text: string[]): string {
  return hash(text.join(FIELD))
}
