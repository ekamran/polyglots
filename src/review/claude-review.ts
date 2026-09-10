import type { Locale, ReviewInput, ReviewResult } from '../types.js'
import {
  ClaudeError,
  MCP_TOOLS,
  buildClaudeArgs as buildArgs,
  childEnv,
  extractStructuredOutput,
  spawnClaude,
  type ClaudeRunOptions,
} from '../claude/run.js'
import { buildReviewPrompt } from './prompt.js'
import { reviewBatchJsonSchema, reviewBatchSchema } from './schema.js'

export const REVIEW_ALLOWED_TOOLS = MCP_TOOLS

export { childEnv, extractStructuredOutput }

export interface ReviewOptions extends ClaudeRunOptions {
  locale: Locale
  nplurals: number
}

export class ReviewError extends Error {
  override readonly name = 'ReviewError'
  readonly stderr: string
  readonly missingKeys: string[]

  constructor(message: string, details: { stderr?: string; missingKeys?: string[] } = {}) {
    super(message)
    this.stderr = details.stderr ?? ''
    this.missingKeys = details.missingKeys ?? []
  }
}

export function buildClaudeArgs(opts: ReviewOptions): string[] {
  return buildArgs(reviewBatchJsonSchema, opts)
}

// Results are matched by the 1-based id assigned in the prompt, so the model
// never has to echo a gettext key (msgctxt keys contain ).
export function mapResults(inputs: ReviewInput[], payload: unknown, nplurals: number): ReviewResult[] {
  const parsed = reviewBatchSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ReviewError(`claude output failed schema validation: ${parsed.error.message.slice(0, 500)}`)
  }

  const byId = new Map<number, (typeof parsed.data.results)[number]>()
  for (const result of parsed.data.results) {
    if (result.id > inputs.length || result.id < 1) {
      throw new ReviewError(`claude output has unknown id ${result.id} for a batch of ${inputs.length}`)
    }
    if (byId.has(result.id)) throw new ReviewError(`claude output has a duplicate id ${result.id}`)
    byId.set(result.id, result)
  }

  const missingKeys = inputs.filter((_, i) => !byId.has(i + 1)).map((input) => input.key)
  if (missingKeys.length > 0) {
    throw new ReviewError(`claude output is missing ${missingKeys.map((k) => JSON.stringify(k)).join(', ')}`, {
      missingKeys,
    })
  }

  return inputs.map((input, i) => {
    const raw = byId.get(i + 1)!
    const expected = input.msgidPlural === undefined ? 1 : nplurals
    const result: ReviewResult = { key: input.key, text: raw.text, fuzzy: raw.fuzzy, reason: raw.reason }
    if (result.text.length !== expected) {
      throw new ReviewError(
        `claude output for key ${JSON.stringify(input.key)} has ${result.text.length} text forms, expected ${expected}`,
      )
    }
    return result
  })
}

export async function reviewBatch(inputs: ReviewInput[], opts: ReviewOptions): Promise<ReviewResult[]> {
  if (inputs.length === 0) return []
  const prompt = buildReviewPrompt(inputs, opts.locale, opts.nplurals)
  try {
    const stdout = await spawnClaude(buildClaudeArgs(opts), prompt, opts)
    return mapResults(inputs, extractStructuredOutput(stdout), opts.nplurals)
  } catch (err) {
    if (err instanceof ClaudeError) throw new ReviewError(err.message, { stderr: err.stderr })
    throw err
  }
}
