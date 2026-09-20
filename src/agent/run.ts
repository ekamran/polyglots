import { spawn } from 'node:child_process'
import {
  AgentError,
  providerSpec,
  schemaArgument,
  type AgentRunOptions,
  type ProviderSpec,
} from './providers.js'

export {
  AgentError,
  configuredModel,
  MCP_TOOLS,
  PROVIDERS,
  DEFAULT_PROVIDER,
  isReviewProvider,
  providerSpec,
  schemaArgument,
  type AgentRunOptions,
  type ProviderSpec,
} from './providers.js'

const STDERR_EXCERPT = 500
const DEFAULT_KILL_GRACE_MS = 2_000

export function buildAgentArgs(jsonSchema: unknown, opts: AgentRunOptions): string[] {
  const spec = providerSpec(opts.provider)
  return spec.buildArgs(schemaArgument(spec, jsonSchema), opts)
}

// A nested agent started from inside a Claude Code session sees CLAUDECODE=1
// and CLAUDE_CODE_* markers; strip them so it behaves like a fresh CLI.
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    out[k] = v
  }
  return out
}

export interface AgentOutput {
  stdout: string
  stderr: string
}

/**
 * Runs the agent CLI to completion, prompt on stdin.
 *
 * Returns stderr alongside stdout rather than discarding it, because both
 * providers have a failure mode that exits zero and explains itself only
 * there: antigravity soft-denies a tool it was not permitted to call, and a
 * quota message arrives without a non-zero status.
 */
export function spawnAgent(argv: string[], prompt: string, opts: AgentRunOptions): Promise<AgentOutput> {
  const spec: ProviderSpec = providerSpec(opts.provider)
  const command = opts.bin ?? spec.bin
  const timeoutMs = opts.timeoutMs ?? spec.defaultTimeoutMs
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: opts.cwd,
      env: childEnv(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    const excerpt = (): string => stderr.slice(0, STDERR_EXCERPT)
    // An agent reports a usage limit on stdout and exits non-zero, so a failure
    // whose stderr is empty still has its reason in hand. Reporting only stderr
    // turned "your quota ran out" into a bare exit code.
    const why = (): string => {
      const out = stdout.trim().slice(0, STDERR_EXCERPT)
      const err = excerpt().trim()
      return [err && `stderr: ${err}`, out && `stdout: ${out}`].filter(Boolean).join('; ') || 'no output'
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, killGraceMs)
      killTimer.unref()
      reject(new AgentError(`${spec.name} timed out after ${timeoutMs}ms; stderr: ${excerpt()}`, { stderr: excerpt() }))
    }, timeoutMs)

    child.stdin.on('error', () => {})
    child.stdin.end(prompt)

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new AgentError(`failed to spawn ${command}: ${err.message}`, { stderr: excerpt() }))
    })

    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer)
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        const how = code === null ? `signal ${signal}` : `exit code ${code}`
        reject(new AgentError(`${spec.name} exited with ${how}; ${why()}`, { stderr: excerpt() }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/**
 * The structured object the agent was asked for.
 *
 * stderr is folded into the error rather than dropped: the failure that
 * produces a well-formed envelope with nothing in it is a denied tool, and the
 * only account of which tool is on stderr.
 */
export function readAgentOutput(output: AgentOutput, opts: AgentRunOptions): unknown {
  const spec = providerSpec(opts.provider)
  try {
    return spec.readEnvelope(output.stdout)
  } catch (err) {
    if (err instanceof AgentError && output.stderr.trim()) {
      // The replacement carries the original's verdict on whether a retry is
      // worth anything. Rebuilding the error here is what attaches the only
      // account of a denied tool there is, and it must not cost the caller the
      // knowledge that the same prompt will be denied again.
      throw new AgentError(`${err.message}; stderr: ${output.stderr.slice(0, STDERR_EXCERPT).trim()}`, {
        stderr: output.stderr,
        retryable: err.retryable,
      })
    }
    throw err
  }
}

export async function runAgent(prompt: string, jsonSchema: unknown, opts: AgentRunOptions): Promise<unknown> {
  return readAgentOutput(await spawnAgent(buildAgentArgs(jsonSchema, opts), prompt, opts), opts)
}
