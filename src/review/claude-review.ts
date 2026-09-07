import { spawn } from 'node:child_process'
import type { Locale, ReviewInput, ReviewResult } from '../types.js'
import { buildReviewPrompt } from './prompt.js'
import { reviewBatchJsonSchema, reviewBatchSchema } from './schema.js'

export const REVIEW_ALLOWED_TOOLS = [
  'mcp__polyglots__glossary_lookup',
  'mcp__polyglots__consistency_lookup',
  'mcp__polyglots__tm_lookup',
] as const

export interface ReviewOptions {
  locale: Locale
  nplurals: number
  mcpConfigPath: string
  claudeBin?: string
  model?: string
  timeoutMs?: number
  killGraceMs?: number
  cwd?: string
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

const STDERR_EXCERPT = 500
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_KILL_GRACE_MS = 2_000

// The prompt is sent on stdin, never as argv: --allowedTools and --mcp-config
// are variadic on the real CLI and would swallow a trailing positional, and
// a batch with long .po comments can exceed ARG_MAX. Each variadic flag is
// still followed by a non-variadic flag so it cannot absorb a later value.
export function buildClaudeArgs(opts: ReviewOptions): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(reviewBatchJsonSchema),
    '--mcp-config',
    opts.mcpConfigPath,
    '--strict-mcp-config',
    '--restricted',
    '--allowedTools',
    REVIEW_ALLOWED_TOOLS.join(','),
    '--permission-prompts',
    'none',
    '--no-session-persistence',
  ]
  if (opts.model) args.push('--model', opts.model)
  return args
}

// A nested claude started from inside a Claude Code session sees CLAUDECODE=1
// and CLAUDE_CODE_* markers; strip them so it behaves like a fresh CLI.
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    out[k] = v
  }
  return out
}

interface SpawnOutcome {
  stdout: string
  stderr: string
}

function runClaude(argv: string[], prompt: string, opts: ReviewOptions): Promise<SpawnOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  return new Promise((resolve, reject) => {
    const child = spawn(opts.claudeBin ?? 'claude', argv, {
      cwd: opts.cwd,
      env: childEnv(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    const excerpt = (): string => stderr.slice(0, STDERR_EXCERPT)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, killGraceMs)
      killTimer.unref()
      reject(
        new ReviewError(`claude review timed out after ${timeoutMs}ms; stderr: ${excerpt()}`, {
          stderr: excerpt(),
        }),
      )
    }, timeoutMs)

    child.stdin.on('error', () => {})
    child.stdin.end(prompt)

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ReviewError(`failed to spawn claude: ${err.message}`, { stderr: excerpt() }))
    })

    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer)
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        const how = code === null ? `signal ${signal}` : `exit code ${code}`
        reject(new ReviewError(`claude exited with ${how}; stderr: ${excerpt()}`, { stderr: excerpt() }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

// The `claude -p --output-format json` envelope is a single object like
// { type: 'result', subtype, is_error, result: string, structured_output?: object, ... }.
// With --json-schema the CLI puts the validated object in `structured_output`;
// `result` is the assistant's final text, which in older builds is the raw JSON
// string. We prefer `structured_output` and fall back to parsing `result`.
export function extractStructuredOutput(stdout: string): unknown {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch {
    throw new ReviewError(`claude stdout is not JSON: ${stdout.slice(0, 200)}`)
  }
  if (typeof envelope !== 'object' || envelope === null) {
    throw new ReviewError('claude stdout JSON is not an object')
  }
  const env = envelope as Record<string, unknown>
  if (env.is_error === true) {
    throw new ReviewError(`claude reported an error: ${String(env.result ?? env.subtype ?? 'unknown')}`)
  }
  if (typeof env.structured_output === 'object' && env.structured_output !== null) {
    return env.structured_output
  }
  if (typeof env.result === 'string') {
    try {
      return JSON.parse(env.result)
    } catch {
      throw new ReviewError(`claude result field is not JSON: ${env.result.slice(0, 200)}`)
    }
  }
  throw new ReviewError('claude envelope has neither structured_output nor a string result')
}

// Results are matched by the 1-based id assigned in the prompt, so the model
// never has to echo a gettext key (msgctxt keys contain ).
export function mapResults(inputs: ReviewInput[], payload: unknown, nplurals: number): ReviewResult[] {
  const parsed = reviewBatchSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ReviewError(`claude output failed schema validation: ${parsed.error.message.slice(0, 500)}`)
  }
  const byId = new Map<number, ReviewResult>()
  const duplicates: number[] = []
  for (const result of parsed.data.results) {
    if (result.id > inputs.length) {
      throw new ReviewError(`claude output contains unknown id ${result.id} (batch has ${inputs.length} entries)`)
    }
    const key = inputs[result.id - 1]!.key
    if (byId.has(result.id)) duplicates.push(result.id)
    else byId.set(result.id, { key, text: result.text, fuzzy: result.fuzzy, reason: result.reason })
  }
  if (duplicates.length > 0) {
    throw new ReviewError(`claude output contains duplicate ids: ${duplicates.join(', ')}`)
  }
  const missingKeys = inputs.filter((_, i) => !byId.has(i + 1)).map((i) => i.key)
  if (missingKeys.length > 0) {
    throw new ReviewError(`claude output is missing keys: ${missingKeys.map((k) => JSON.stringify(k)).join(', ')}`, {
      missingKeys,
    })
  }
  return inputs.map((input, i) => {
    const result = byId.get(i + 1)!
    const expected = input.msgidPlural !== undefined ? nplurals : 1
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
  const { stdout } = await runClaude(buildClaudeArgs(opts), prompt, opts)
  return mapResults(inputs, extractStructuredOutput(stdout), opts.nplurals)
}
