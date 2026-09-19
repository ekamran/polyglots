import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AgentError,
  DEFAULT_PROVIDER,
  isReviewProvider,
  MCP_TOOLS,
  PROVIDERS,
  providerSpec,
  schemaArgument,
} from '../../src/agent/providers.js'
import { buildAgentArgs, readAgentOutput } from '../../src/agent/run.js'

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } } }
const base = { mcpConfigPath: '/tmp/mcp.json' }

describe('provider registry', () => {
  it('defaults to claude, which is what every cached verdict was formed under', () => {
    expect(DEFAULT_PROVIDER).toBe('claude')
    expect(providerSpec().name).toBe('claude')
    expect(providerSpec(undefined).name).toBe('claude')
  })

  it('knows its own names and rejects anything else', () => {
    expect([...PROVIDERS]).toEqual(['claude', 'antigravity'])
    expect(isReviewProvider('antigravity')).toBe(true)
    expect(isReviewProvider('gemini')).toBe(false)
  })
})

describe('claude arguments', () => {
  const args = buildAgentArgs(SCHEMA, base)

  it('restricts the run to the three polyglots tools', () => {
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--restricted')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(MCP_TOOLS.join(','))
  })

  it('passes the schema as argv text', () => {
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(SCHEMA))
  })

  // Each variadic flag is followed by another flag, so it cannot swallow a
  // later value.
  it('never leaves a variadic flag last', () => {
    for (const flag of ['--mcp-config', '--allowedTools']) {
      expect(args.indexOf(flag)).toBeLessThan(args.length - 2)
    }
  })
})

describe('antigravity arguments', () => {
  const args = buildAgentArgs(SCHEMA, { ...base, provider: 'antigravity', timeoutMs: 90_000 })

  // Its -p requires the prompt inline, which would put a whole batch into argv.
  // Omitting it makes the CLI read stdin, which has no such ceiling.
  it('omits -p so the prompt goes on stdin', () => {
    expect(args).not.toContain('-p')
    expect(args).not.toContain('--print')
  })

  // It has no per-invocation MCP flags at all; the server is registered with it
  // once, out of band.
  it('passes no MCP flags, which it does not have', () => {
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--allowedTools')
  })

  it('never auto-approves every tool', () => {
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  // Its own default is five minutes and would otherwise cut a batch short of
  // the caller's limit, reporting a failure the caller did not set.
  it('hands it the caller timeout rather than letting its own default win', () => {
    expect(args[args.indexOf('--print-timeout') + 1]).toBe('90s')
  })

  it('writes the schema out and passes the path', () => {
    const path = args[args.indexOf('--json-schema') + 1]!
    expect(path).not.toBe(JSON.stringify(SCHEMA))
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(SCHEMA)
  })

  it('reuses one file per schema rather than writing one per batch', () => {
    const spec = providerSpec('antigravity')
    expect(schemaArgument(spec, SCHEMA)).toBe(schemaArgument(spec, { ...SCHEMA }))
  })
})

describe('reading a claude envelope', () => {
  const read = (stdout: string) => readAgentOutput({ stdout, stderr: '' }, base)

  it('prefers the validated structured output', () => {
    expect(read(JSON.stringify({ structured_output: { ok: true }, result: '{"ok":false}' }))).toEqual({ ok: true })
  })

  it('falls back to the result string older builds used', () => {
    expect(read(JSON.stringify({ result: '{"ok":true}' }))).toEqual({ ok: true })
  })

  it('raises what the CLI reported rather than a parse failure', () => {
    expect(() => read(JSON.stringify({ is_error: true, result: 'usage limit reached' }))).toThrow(/usage limit reached/)
  })
})

describe('reading an antigravity envelope', () => {
  const opts = { ...base, provider: 'antigravity' as const }
  const read = (stdout: string, stderr = '') => readAgentOutput({ stdout, stderr }, opts)

  it('reads the same structured_output field claude uses', () => {
    expect(read(JSON.stringify({ status: 'SUCCESS', structured_output: { ok: true } }))).toEqual({ ok: true })
  })

  // Its terminal state is a status string, not claude's is_error boolean.
  it('treats any status but SUCCESS as a failure, quoting its error', () => {
    expect(() => read(JSON.stringify({ status: 'ERROR', error: 'model unavailable' }))).toThrow(/model unavailable/)
  })

  it('parses the response string when no structured output came back', () => {
    expect(read(JSON.stringify({ status: 'SUCCESS', response: '{"ok":true}' }))).toEqual({ ok: true })
  })

  /**
   * The failure that actually happens in practice: a tool it was not permitted
   * to call is soft-denied, so it exits zero with a null structured_output and
   * explains itself only on stderr. Dropping stderr turns a fixable setup
   * problem into "no structured output".
   */
  it('carries the stderr that names the denied tool into the error', () => {
    const stdout = JSON.stringify({ status: 'SUCCESS', structured_output: null })
    const stderr = 'a tool required the "mcp" permission that headless mode cannot prompt for'
    expect(() => read(stdout, stderr)).toThrow(/mcp.*permission/)
  })

  it('reports a non-JSON stdout as such, not as a missing field', () => {
    expect(() => read('command not found: agy')).toThrow(AgentError)
    expect(() => read('command not found: agy')).toThrow(/not JSON/)
  })
})
