import { createHash } from 'node:crypto'
import type { Adjudicator } from '../audit/audit.js'
import { buildAuditPrompt } from '../audit/prompt.js'
import { auditBatchJsonSchema, mapAuditResults } from '../audit/schema.js'
import type { LocalChat } from '../draft/local-chat.js'
import { extractJson } from '../draft/qwen.js'
import type { LocalServerKind, Locale, ReviewInput, ReviewResult } from '../types.js'
import { mapResults, type ReviewOptions } from './draft-review.js'
import { buildReviewPrompt } from './prompt.js'
import { docsUrl } from '../docs-links.js'
import { reviewBatchJsonSchema } from './schema.js'

/**
 * A local model as the reviewer: experimental, and only ever chosen on purpose.
 *
 * The 2026-09-18 benchmark ran a local qwen against claude on a 294-entry
 * submission and found it added nothing over the deterministic rules: it
 * caught none of the problems the rules missed, and wrongly cleared twenty
 * real ones. This exists so that finding can be re-checked with newer models,
 * not because it was overturned. So it is never the default, never selected
 * by anything but `config set reviewProvider local`, and says so whenever it
 * runs.
 *
 * A chat model has no MCP, so it gets what the tools would have answered in
 * the prompt instead. The audit prompt already carries each entry's glossary
 * terms and memory inline; translate's prompt is given the glossary terms
 * here. The answer is the same shape an agent's is and goes through the same
 * validation, so review and translate need to know nothing else about it.
 */

// Small because a local context is small; see notes/local-models.md for the
// arithmetic. By the estimate below, twelve entries and their replies come to
// about 3,600 tokens on the Turkish prompt, the largest one shipped: inside a
// 4,096-token context, the smallest a local server is commonly left at, with
// about a tenth to spare for the long string the per-entry average does not
// cover. Twenty, the first choice, came to 3,988 under a laxer estimate and
// left no room at all. A smaller configured batch is never raised.
export const DEFAULT_LOCAL_REVIEW_BATCH = 12

export const LOCAL_REVIEW_NOTICE =
  `Local review is experimental: the 2026-09-18 benchmark found a local model added nothing over the rules. See ${docsUrl('local-models')}`

/** The batch size a local review uses when the person named none. */
export function localReviewBatchSize(configured: number): number {
  return Math.min(configured, DEFAULT_LOCAL_REVIEW_BATCH)
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * What the no-tools audit prompt says that the agents' one does not, as a key
 * part. Hashing the whole template rather than the three sentences that differ
 * means a later edit to either is covered without anyone remembering which.
 */
export function auditPromptVariant(locale: Locale): string {
  return digest(buildAuditPrompt([], locale, 2, undefined, { tools: false }))
}

/** The same for translate's draft review prompt. */
export function draftReviewPromptVariant(locale: Locale): string {
  return digest(buildReviewPrompt([], locale, 2, undefined, { tools: false }))
}

// Every failure says which model produced it: with two local servers
// configured, "invalid JSON" alone does not say where to look.
function withModel<T>(model: string, run: () => T): T {
  try {
    return run()
  } catch (err) {
    throw new Error(`${model}: ${(err as Error).message}`, { cause: err })
  }
}

/** Review's adjudicator, answered by a local model instead of an agent CLI. */
export function createLocalAdjudicator(chat: LocalChat, model: string): Adjudicator {
  return async (batch, opts) => {
    let reply: string
    try {
      reply = await chat({
        user: buildAuditPrompt(batch, opts.locale, opts.nplurals, opts.pluralForms, { tools: false }),
        schema: auditBatchJsonSchema,
        schemaName: 'audit',
      })
    } catch (err) {
      throw new Error(`${model}: ${(err as Error).message}`, { cause: err })
    }
    return withModel(model, () => mapAuditResults(batch, extractJson(reply)))
  }
}

export type DraftReviewer = (inputs: ReviewInput[], opts: ReviewOptions) => Promise<ReviewResult[]>

/** translate's AI pass, answered by a local model. Same contract as reviewBatch. */
export function createLocalDraftReviewer(chat: LocalChat, model: string): DraftReviewer {
  return async (inputs, opts) => {
    if (inputs.length === 0) return []
    let reply: string
    try {
      reply = await chat({
        user: buildReviewPrompt(inputs, opts.locale, opts.nplurals, opts.pluralForms, { tools: false }),
        schema: reviewBatchJsonSchema,
        schemaName: 'review',
      })
    } catch (err) {
      throw new Error(`${model}: ${(err as Error).message}`, { cause: err })
    }
    return withModel(model, () => mapResults(inputs, extractJson(reply), opts.nplurals))
  }
}

// --- How much fits --------------------------------------------------------

// Characters per token, set low so the estimate errs high. English prose runs
// near four on common tokenizers, but Turkish suffixes and the JSON around
// every entry tokenize denser, and 3.5 was optimistic for exactly the locale
// this tool is used for most. A warning that fires a little early costs a
// glance; a prompt silently cut at the context edge costs a batch of verdicts
// formed on half the entries.
const CHARS_PER_TOKEN = 3

// Per entry, by the same estimate. Measured on the 0.23 prompts: a bare entry
// (source, submission, one reference) is about 37 tokens, and one carrying a
// glossary term and a rule hint about 116. A flagged result with a fix is
// about 68 tokens of reply and a cleared one about 20. These sit between,
// weighted towards the heavy end, because a long source or a memory with
// several wordings is what pushes a batch over the edge.
export const ENTRY_PROMPT_TOKENS = 95
export const ENTRY_REPLY_TOKENS = 40

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** The estimated size of one local review batch, prompt and reply together. */
export function estimateBatchTokens(locale: Locale, batchSize: number): number {
  const template = estimateTokens(buildAuditPrompt([], locale, 2, undefined, { tools: false }))
  return template + batchSize * (ENTRY_PROMPT_TOKENS + ENTRY_REPLY_TOKENS)
}

export interface LocalBatchAdviceInput {
  batchSize: number
  locale: Locale
  model: string
  // Which kind of server: an Ollama with no context set is the one case worth
  // a line every time, because its default is small and it truncates silently.
  kind?: LocalServerKind
  // Known from config or from the server's listing; undefined when neither said.
  contextLength?: number
}

/**
 * A warning about a local review batch that will not fit, or undefined.
 *
 * It never refuses. The estimate is an estimate, and the first batch's own
 * result is the authority; what this prevents is a run that reads fine and
 * was judged on a prompt the server cut short without saying so.
 */
export function localBatchAdvice(input: LocalBatchAdviceInput): string | undefined {
  const tokens = estimateBatchTokens(input.locale, input.batchSize)
  const format = (n: number) => n.toLocaleString('en-US')
  if (input.contextLength !== undefined) {
    if (tokens <= input.contextLength) return undefined
    const template = estimateBatchTokens(input.locale, 0)
    const fits = Math.floor((input.contextLength - template) / (ENTRY_PROMPT_TOKENS + ENTRY_REPLY_TOKENS))
    // "A batch size of 0 or less" is not advice. A context too small for the
    // instructions themselves needs a different model or setting, not a
    // smaller batch.
    if (fits < 1) {
      return `The ${format(input.contextLength)}-token context of ${input.model} cannot hold the review prompt at all (about ${format(template)} tokens before any entry). Raise the context or use a model with a larger one.`
    }
    return `A local review batch of ${input.batchSize} is about ${format(tokens)} tokens, more than the ${format(input.contextLength)}-token context of ${input.model}. Use a batch size of ${fits} or less.`
  }
  // Stock Ollama: the context is whatever its default is, which can be 4,096
  // or less, and a longer prompt is cut without an error. Said on every run
  // until it is set, because nothing else will ever say it.
  if (input.kind === 'ollama') {
    return `A local review batch of ${input.batchSize} is about ${format(tokens)} tokens, and Ollama's context for ${input.model} is not set; its default can be 4,096 tokens or less and cuts longer prompts without a word. Set it with: polyglots config set ollama.contextLength <tokens>`
  }
  if (input.batchSize <= DEFAULT_LOCAL_REVIEW_BATCH) return undefined
  return `A local review batch of ${input.batchSize} is about ${format(tokens)} tokens. The context of ${input.model} is not known; if it is smaller, the prompt is cut short without a word. See ${docsUrl('local-models')}`
}
