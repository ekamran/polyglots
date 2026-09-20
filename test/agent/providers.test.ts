import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AgentError,
  configuredModel,
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

  /**
   * Its limit sits just inside the caller's so that it, not the kill, decides a
   * timeout and gets to explain it. Given the same deadline both fired at once
   * and the process was signalled before it could write anything, so every
   * timeout arrived with an empty stderr. Its own default is 0, wait forever,
   * so the flag cannot simply be left off either.
   */
  it('takes a limit just inside the caller own, so it reports the timeout', () => {
    expect(args[args.indexOf('--print-timeout') + 1]).toBe('60s')
  })

  it('never asks for a nonsensical limit when the caller allows very little', () => {
    const tight = buildAgentArgs(SCHEMA, { ...base, provider: 'antigravity', timeoutMs: 5_000 })
    expect(tight[tight.indexOf('--print-timeout') + 1]).toBe('30s')
  })

  // Without a caller limit it still needs one, because waiting forever is its
  // own default and a stuck batch would never be reported.
  it('falls back to its own generous default rather than waiting forever', () => {
    const bare = buildAgentArgs(SCHEMA, { ...base, provider: 'antigravity' })
    expect(bare).toContain('--print-timeout')
    expect(providerSpec('antigravity').defaultTimeoutMs).toBeGreaterThan(providerSpec('claude').defaultTimeoutMs)
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

  /**
   * Whether a failure is worth a second attempt is a property of the failure,
   * not of the caller. An agent that answered and chose to produce nothing
   * usable will choose the same again given the same prompt; an agent that ran
   * out of time or exited non-zero may not.
   */
  it('marks an answer it will give again as not worth a retry', () => {
    const denied = JSON.stringify({ status: 'SUCCESS', structured_output: null })
    expect(() => read(denied)).toThrow(AgentError)
    try {
      read(denied)
    } catch (err) {
      expect((err as AgentError).retryable).toBe(false)
    }
  })

  // stderr is folded into a fresh error, which must not quietly lose the flag.
  it('keeps the flag when the stderr excerpt is folded in', () => {
    try {
      read(JSON.stringify({ status: 'SUCCESS', structured_output: null }), 'a tool required the "command" permission')
    } catch (err) {
      expect((err as AgentError).message).toMatch(/command/)
      expect((err as AgentError).retryable).toBe(false)
    }
  })

  // A status the CLI itself reports can be load or a model being briefly
  // unavailable, which is exactly what a retry is for.
  it('leaves a failure the CLI reported worth retrying', () => {
    try {
      read(JSON.stringify({ status: 'ERROR', error: 'model unavailable' }))
    } catch (err) {
      expect((err as AgentError).retryable).toBe(true)
    }
  })
})

/**
 * antigravity takes its model from its own settings file, and polyglots passes
 * no --model, so a verdict formed by Flash and one formed by Pro were both
 * recorded as plain `antigravity` and each would be served as the other. That
 * is the same shape as the bug where every `antigravity` row was Claude's
 * work: an engine id that does not name the engine.
 */
describe('the model a provider will actually use', () => {
  const home = mkdtempSync(join(tmpdir(), 'polyglots-home-'))
  const settings = join(home, '.gemini', 'antigravity-cli')
  mkdirSync(settings, { recursive: true })

  it('reads what antigravity is configured to run', () => {
    writeFileSync(join(settings, 'settings.json'), JSON.stringify({ model: 'Gemini 3.8 Flash (Medium)' }))
    expect(configuredModel('antigravity', home)).toBe('Gemini 3.8 Flash (Medium)')
  })

  // Claude is told its model by us or picks its own, and has no equivalent file.
  it('claims nothing about claude', () => {
    expect(configuredModel('claude', home)).toBeUndefined()
  })

  // Fails open, the way the build guard does: an unreadable setting must not
  // stop a review, and a bare provider name is what every earlier row used.
  it('says nothing rather than guessing when the file is missing or broken', () => {
    const empty = mkdtempSync(join(tmpdir(), 'polyglots-home-'))
    expect(configuredModel('antigravity', empty)).toBeUndefined()
    mkdirSync(join(empty, '.gemini', 'antigravity-cli'), { recursive: true })
    writeFileSync(join(empty, '.gemini', 'antigravity-cli', 'settings.json'), '{ not json')
    expect(configuredModel('antigravity', empty)).toBeUndefined()
    writeFileSync(join(empty, '.gemini', 'antigravity-cli', 'settings.json'), JSON.stringify({ model: 42 }))
    expect(configuredModel('antigravity', empty)).toBeUndefined()
  })
})
