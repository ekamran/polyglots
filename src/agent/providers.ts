import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewProvider } from '../types.js'

// The only tools a review is allowed to reach for. Both providers restrict to
// these, by different means: Claude takes a flag, antigravity takes allow-rules
// in its own settings file, which is why it needs a documented setup step.
export const MCP_TOOLS = [
  'mcp__polyglots__glossary_lookup',
  'mcp__polyglots__consistency_lookup',
  'mcp__polyglots__tm_lookup',
] as const

// Enough for the agent to notice its own deadline and report it before the
// caller's timer gives up on it.
const GRACE_SECONDS = 30

export const PROVIDERS: readonly ReviewProvider[] = ['claude', 'antigravity']

// Claude stays the default. It is the faster of the two and the more
// conservative, and it is what every cached verdict was formed under.
export const DEFAULT_PROVIDER: ReviewProvider = 'claude'

export function isReviewProvider(value: string): value is ReviewProvider {
  return (PROVIDERS as readonly string[]).includes(value)
}

export class AgentError extends Error {
  override readonly name: string = 'AgentError'
  readonly stderr: string

  constructor(message: string, details: { stderr?: string } = {}) {
    super(message)
    this.stderr = details.stderr ?? ''
  }
}

export interface AgentRunOptions {
  mcpConfigPath: string
  // Which CLI to drive. Absent means the default, so every existing caller that
  // passed nothing keeps driving Claude.
  provider?: ReviewProvider
  // Overrides the provider's binary, for tests and for an install that is not
  // on PATH.
  bin?: string
  model?: string
  cwd?: string
  timeoutMs?: number
  killGraceMs?: number
}

export interface ProviderSpec {
  name: ReviewProvider
  bin: string
  /**
   * How the JSON schema reaches the CLI.
   *
   * Claude takes it as argv text. antigravity accepts either, and a path is
   * chosen for it because argv is a shared budget with the prompt, and the
   * audit schema is the larger of the two constants.
   */
  schemaAs: 'inline' | 'file'
  /**
   * How long one batch may take, when the caller names no limit.
   *
   * A property of the agent, not of the work. Claude issues its tool calls
   * concurrently; antigravity issues one per planner turn, so the same batch
   * costs it twenty-odd sequential round trips and a shared 300s ceiling cut
   * its slower batches off mid-question.
   */
  defaultTimeoutMs: number
  buildArgs(schema: string, opts: AgentRunOptions): string[]
  /** The provider's own envelope, reduced to the object the schema asked for. */
  readEnvelope(stdout: string): unknown
}

function envelopeOf(stdout: string, provider: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new AgentError(`${provider} stdout is not JSON: ${stdout.slice(0, 200)}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AgentError(`${provider} stdout JSON is not an object`)
  }
  return parsed as Record<string, unknown>
}

// Both providers put the schema-validated object here, under the same name.
// It is preferred over the assistant's text in both cases because it is the
// only field either one guarantees has been checked against the schema.
function structuredOutput(env: Record<string, unknown>): unknown | undefined {
  const value = env.structured_output
  return typeof value === 'object' && value !== null ? value : undefined
}

const claude: ProviderSpec = {
  name: 'claude',
  bin: 'claude',
  schemaAs: 'inline',
  defaultTimeoutMs: 300_000,
  // The prompt is sent on stdin, never as argv: --allowedTools and --mcp-config
  // are variadic on the real CLI and would swallow a trailing positional, and
  // a batch with long .po comments can exceed ARG_MAX. Each variadic flag is
  // still followed by a non-variadic flag so it cannot absorb a later value.
  buildArgs(schema, opts) {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--mcp-config',
      opts.mcpConfigPath,
      '--strict-mcp-config',
      '--restricted',
      '--allowedTools',
      MCP_TOOLS.join(','),
      '--permission-prompts',
      'none',
      '--no-session-persistence',
    ]
    if (opts.model) args.push('--model', opts.model)
    return args
  },
  // { type: 'result', subtype, is_error, result: string, structured_output?: object }
  readEnvelope(stdout) {
    const env = envelopeOf(stdout, 'claude')
    if (env.is_error === true) {
      throw new AgentError(`claude reported an error: ${String(env.result ?? env.subtype ?? 'unknown')}`)
    }
    const output = structuredOutput(env)
    if (output !== undefined) return output
    // Older builds put the raw JSON string in `result` instead.
    if (typeof env.result === 'string') {
      try {
        return JSON.parse(env.result)
      } catch {
        throw new AgentError(`claude result field is not JSON: ${env.result.slice(0, 200)}`)
      }
    }
    throw new AgentError('claude envelope has neither structured_output nor a string result')
  },
}

const antigravity: ProviderSpec = {
  name: 'antigravity',
  bin: 'agy',
  schemaAs: 'file',
  // Measured: batches that finished took two to three and a half minutes, and
  // every one that needed more than about 28 tool calls hit the old 300s
  // ceiling. Twenty minutes is room for the tail rather than an expectation.
  defaultTimeoutMs: 1_200_000,
  /**
   * No `-p`. Its `-p` requires its value inline, which would put a whole batch
   * of source strings and comments into argv; omitting it makes the CLI read
   * the prompt from stdin, which has no such ceiling.
   *
   * No MCP flags either. antigravity has no per-invocation equivalent of
   * --mcp-config, so the server is registered with it once and the tools are
   * permitted by allow-rules in its settings. That is the setup documented in
   * docs/antigravity.md, and without it every tool call is silently denied and
   * the run returns no structured output.
   */
  buildArgs(schema, opts) {
    const args = ['--output-format', 'json', '--json-schema', schema]
    // Its own limit is set just inside ours so that it, not the kill, decides a
    // timeout and gets to say why. Given the same deadline both fire at once,
    // the process is signalled before it can write anything, and every timeout
    // was reported with an empty stderr. Its own default is 0, meaning wait
    // forever, so leaving the flag off would put the whole burden on the kill.
    const budget = opts.timeoutMs ?? antigravity.defaultTimeoutMs
    args.push('--print-timeout', `${Math.max(30, Math.floor(budget / 1000) - GRACE_SECONDS)}s`)
    if (opts.model) args.push('--model', opts.model)
    return args
  },
  // { conversation_id, status, response: string, error?, structured_output?, usage }
  readEnvelope(stdout) {
    const env = envelopeOf(stdout, 'antigravity')
    const status = typeof env.status === 'string' ? env.status : 'unknown'
    if (status !== 'SUCCESS') {
      throw new AgentError(`antigravity reported ${status}: ${String(env.error ?? 'no error given')}`)
    }
    const output = structuredOutput(env)
    if (output !== undefined) return output
    // A soft-denied tool exits zero with a null structured_output and says why
    // on stderr, so the caller attaches that rather than leaving this bare.
    if (typeof env.response === 'string') {
      try {
        return JSON.parse(env.response)
      } catch {
        throw new AgentError(`antigravity response field is not JSON: ${env.response.slice(0, 200)}`)
      }
    }
    throw new AgentError('antigravity produced no structured output; a tool it needed was most likely denied')
  },
}

const SPECS: Record<ReviewProvider, ProviderSpec> = { claude, antigravity }

export function providerSpec(name: ReviewProvider = DEFAULT_PROVIDER): ProviderSpec {
  return SPECS[name]
}

// Written once per distinct schema and reused, keyed by content: the two
// schemas in this tree are module constants, so this writes two files for the
// life of the process rather than one per batch.
const schemaFiles = new Map<string, string>()

export function schemaArgument(spec: ProviderSpec, jsonSchema: unknown): string {
  const text = JSON.stringify(jsonSchema)
  if (spec.schemaAs === 'inline') return text
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const cached = schemaFiles.get(digest)
  if (cached) return cached
  const path = join(tmpdir(), `polyglots-schema-${digest}.json`)
  writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
  schemaFiles.set(digest, path)
  return path
}

/**
 * A warning about a batch size that will cost more than it saves, or undefined.
 *
 * Shrinking a batch is the obvious response to a timeout and it is the wrong
 * one here. Measured on real runs: a 25-entry batch drew 11 tool calls, while
 * 10-entry batches drew 22 to 31, so the smaller batch spent roughly six times
 * as many round trips per entry and still paid the same fixed cost of reading
 * the tool schemas at the start of each one. The agent grows more thorough as
 * it is given less to do.
 */
export function batchAdvice(provider: ReviewProvider | undefined, batchSize: number): string | undefined {
  if ((provider ?? DEFAULT_PROVIDER) !== 'antigravity') return undefined
  if (batchSize >= ANTIGRAVITY_MIN_BATCH) return undefined
  return `antigravity asks its tools one at a time, so a batch of ${batchSize} costs more round trips per entry than a batch of ${ANTIGRAVITY_MIN_BATCH}, not fewer. Raise the batch size rather than lowering it.`
}

// Below this, the per-entry cost climbs instead of falling.
export const ANTIGRAVITY_MIN_BATCH = 25
