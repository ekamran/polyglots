import { spawn } from 'node:child_process'

export const MCP_TOOLS = [
  'mcp__polyglots__glossary_lookup',
  'mcp__polyglots__consistency_lookup',
  'mcp__polyglots__tm_lookup',
] as const

export class ClaudeError extends Error {
  override readonly name: string = 'ClaudeError'
  readonly stderr: string

  constructor(message: string, details: { stderr?: string } = {}) {
    super(message)
    this.stderr = details.stderr ?? ''
  }
}

export interface ClaudeRunOptions {
  mcpConfigPath: string
  claudeBin?: string
  model?: string
  cwd?: string
  timeoutMs?: number
  killGraceMs?: number
}

const STDERR_EXCERPT = 500
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_KILL_GRACE_MS = 2_000

// The prompt is sent on stdin, never as argv: --allowedTools and --mcp-config
// are variadic on the real CLI and would swallow a trailing positional, and
// a batch with long .po comments can exceed ARG_MAX. Each variadic flag is
// still followed by a non-variadic flag so it cannot absorb a later value.
export function buildClaudeArgs(jsonSchema: unknown, opts: ClaudeRunOptions): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(jsonSchema),
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

export function spawnClaude(argv: string[], prompt: string, opts: ClaudeRunOptions): Promise<string> {
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
      reject(new ClaudeError(`claude timed out after ${timeoutMs}ms; stderr: ${excerpt()}`, { stderr: excerpt() }))
    }, timeoutMs)

    child.stdin.on('error', () => {})
    child.stdin.end(prompt)

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ClaudeError(`failed to spawn claude: ${err.message}`, { stderr: excerpt() }))
    })

    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer)
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        const how = code === null ? `signal ${signal}` : `exit code ${code}`
        reject(new ClaudeError(`claude exited with ${how}; stderr: ${excerpt()}`, { stderr: excerpt() }))
        return
      }
      resolve(stdout)
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
    throw new ClaudeError(`claude stdout is not JSON: ${stdout.slice(0, 200)}`)
  }
  if (typeof envelope !== 'object' || envelope === null) {
    throw new ClaudeError('claude stdout JSON is not an object')
  }
  const env = envelope as Record<string, unknown>
  if (env.is_error === true) {
    throw new ClaudeError(`claude reported an error: ${String(env.result ?? env.subtype ?? 'unknown')}`)
  }
  if (typeof env.structured_output === 'object' && env.structured_output !== null) {
    return env.structured_output
  }
  if (typeof env.result === 'string') {
    try {
      return JSON.parse(env.result)
    } catch {
      throw new ClaudeError(`claude result field is not JSON: ${env.result.slice(0, 200)}`)
    }
  }
  throw new ClaudeError('claude envelope has neither structured_output nor a string result')
}

export async function runClaude(prompt: string, jsonSchema: unknown, opts: ClaudeRunOptions): Promise<unknown> {
  return extractStructuredOutput(await spawnClaude(buildClaudeArgs(jsonSchema, opts), prompt, opts))
}
