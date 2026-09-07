import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReviewError, buildClaudeArgs, childEnv, mapResults, reviewBatch } from '../../src/review/claude-review.js'
import { reviewBatchJsonSchema } from '../../src/review/schema.js'
import type { ReviewInput } from '../../src/types.js'

const fakeClaude = fileURLToPath(new URL('../fixtures/fake-claude/claude', import.meta.url))

const CTX_KEY = 'post statusPublished'

const inputs: ReviewInput[] = [
  { key: 'Save changes', msgid: 'Save changes', comments: [], drafts: ['Değişiklikleri kaydet'] },
  {
    key: CTX_KEY,
    msgid: 'Published',
    msgctxt: 'post status',
    comments: ['status label'],
    drafts: ['Yayımlandı'],
  },
  { key: 'FUZZY: Hook', msgid: 'Hook', comments: [], drafts: ['Kanca'] },
  { key: '%d item', msgid: '%d item', msgidPlural: '%d items', comments: [], drafts: ['%d öğe', '%d öğe'] },
]

let dir: string
let mcpConfigPath: string
const savedEnv = { ...process.env }

const base = () => ({ locale: 'tr', nplurals: 2, mcpConfigPath, claudeBin: fakeClaude })

async function setup(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'polyglots-review-'))
  mcpConfigPath = join(dir, 'mcp.json')
  await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }))
}

async function isAlive(pid: number): Promise<boolean> {
  const alive = (): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 20))
  return alive()
}

beforeAll(async () => {
  await chmod(fakeClaude, 0o755)
})

afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('reviewBatch', () => {
  it('maps ids back to keys (including msgctxt keys with \\u0004), in input order', async () => {
    await setup()
    const results = await reviewBatch(inputs, base())
    expect(results.map((r) => r.key)).toEqual(inputs.map((i) => i.key))
    expect(results[0]).toEqual({ key: 'Save changes', text: ['[tr] Save changes'], fuzzy: false, reason: 'fake' })
    expect(results[1]!.key).toBe(CTX_KEY)
    expect(results[1]!.text).toEqual(['[tr] Published'])
    expect(results[2]!.fuzzy).toBe(true)
    expect(results[3]!.text).toEqual(['[tr] %d item', '[tr] %d items'])
    expect(results[3]!.fuzzy).toBe(false)
  })

  it('passes the exact argv flags and the schema payload, and sends the prompt on stdin (not argv)', async () => {
    await setup()
    const argsOut = join(dir, 'args.json')
    const stdinOut = join(dir, 'stdin.txt')
    process.env.FAKE_CLAUDE_ARGS_OUT = argsOut
    process.env.FAKE_CLAUDE_STDIN_OUT = stdinOut
    await reviewBatch(inputs, { ...base(), model: 'sonnet' })
    const argv = JSON.parse(await readFile(argsOut, 'utf8')) as string[]

    expect(argv[0]).toBe('-p')
    const flagAt = (flag: string): number => {
      const i = argv.indexOf(flag)
      expect(i, `missing ${flag}`).toBeGreaterThan(-1)
      return i
    }
    expect(argv[flagAt('--output-format') + 1]).toBe('json')
    expect(JSON.parse(argv[flagAt('--json-schema') + 1]!)).toEqual(reviewBatchJsonSchema)
    expect(argv[flagAt('--mcp-config') + 1]).toBe(mcpConfigPath)
    flagAt('--strict-mcp-config')
    flagAt('--restricted')
    expect(argv[flagAt('--allowedTools') + 1]).toBe(
      'mcp__polyglots__glossary_lookup,mcp__polyglots__consistency_lookup,mcp__polyglots__tm_lookup',
    )
    expect(argv[flagAt('--permission-prompts') + 1]).toBe('none')
    flagAt('--no-session-persistence')
    expect(argv[flagAt('--model') + 1]).toBe('sonnet')

    for (const arg of argv) expect(arg).not.toContain('nplurals:')
    const prompt = await readFile(stdinOut, 'utf8')
    expect(prompt).toContain('nplurals: 2')
    expect(prompt).toContain('"msgctxt":"post status"')
  })

  it('never lets a positional follow a variadic flag (--allowedTools / --mcp-config swallow trailing values)', () => {
    const argv = buildClaudeArgs({ ...base(), model: 'sonnet' })
    const variadic = ['--allowedTools', '--mcp-config']
    for (let i = 0; i < argv.length; i++) {
      if (!variadic.includes(argv[i]!)) continue
      const after = argv[i + 2]
      expect(after, `${argv[i]} must be followed by exactly one value then a flag`).toMatch(/^-/)
    }
    expect(argv[argv.length - 1]).toBe('sonnet')
    expect(argv[argv.length - 2]).toBe('--model')
  })

  it('omits --model when not given', async () => {
    await setup()
    const argsOut = join(dir, 'args.json')
    process.env.FAKE_CLAUDE_ARGS_OUT = argsOut
    await reviewBatch(inputs, base())
    const argv = JSON.parse(await readFile(argsOut, 'utf8')) as string[]
    expect(argv).not.toContain('--model')
  })

  it('strips CLAUDECODE and CLAUDE_CODE_* from the child env but forwards everything else', async () => {
    await setup()
    const envOut = join(dir, 'env.json')
    process.env.FAKE_CLAUDE_ENV_OUT = envOut
    process.env.CLAUDECODE = '1'
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    process.env.CLAUDE_CODE_SESSION_ID = 'abc'
    process.env.POLYGLOTS_TEST_PASSTHROUGH = 'yes'
    await reviewBatch(inputs, base())
    const env = JSON.parse(await readFile(envOut, 'utf8')) as Record<string, string>
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT')
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env.POLYGLOTS_TEST_PASSTHROUGH).toBe('yes')
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('childEnv drops only the nested-session markers', () => {
    const env = childEnv({ CLAUDECODE: '1', CLAUDE_CODE_X: '1', CLAUDE_PID: '5', HOME: '/h', PATH: '/p' })
    expect(env).toEqual({ CLAUDE_PID: '5', HOME: '/h', PATH: '/p' })
  })

  it('falls back to parsing the result string when structured_output is absent', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'result-only'
    const results = await reviewBatch(inputs, base())
    expect(results).toHaveLength(4)
    expect(results[0]!.text).toEqual(['[tr] Save changes'])
  })

  it('throws ReviewError on malformed stdout', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'malformed'
    await expect(reviewBatch(inputs, base())).rejects.toBeInstanceOf(ReviewError)
  })

  it('throws ReviewError including stderr on non-zero exit', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'exit1'
    const err = await reviewBatch(inputs, base()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toMatch(/exit code 1/)
    expect((err as ReviewError).message).toContain('fake claude failure')
  })

  it('throws ReviewError naming the missing key (the original gettext key, not the id)', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'missing-id'
    const err = await reviewBatch(inputs, base()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toContain(JSON.stringify(CTX_KEY))
    expect((err as ReviewError).missingKeys).toEqual([CTX_KEY])
  })

  it('throws ReviewError on a duplicated id', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'duplicate-id'
    await expect(reviewBatch(inputs, base())).rejects.toThrow(/duplicate/i)
  })

  it('throws ReviewError on an id outside the batch', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'unknown-id'
    await expect(reviewBatch(inputs, base())).rejects.toThrow(/unknown id 99/)
  })

  it('throws ReviewError when a plural result has the wrong number of forms', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'short-plural'
    await expect(reviewBatch(inputs, base())).rejects.toThrow(/%d item/)
  })

  it('throws ReviewError when a text form is empty', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'empty-text'
    await expect(reviewBatch(inputs, base())).rejects.toThrow(/schema validation/)
  })

  it('throws ReviewError when the CLI reports is_error', async () => {
    await setup()
    process.env.FAKE_CLAUDE_MODE = 'is-error'
    await expect(reviewBatch(inputs, base())).rejects.toThrow(/fake error result/)
  })

  it('throws ReviewError when the binary cannot be spawned', async () => {
    await setup()
    await expect(reviewBatch(inputs, { ...base(), claudeBin: join(dir, 'no-such-claude') })).rejects.toBeInstanceOf(
      ReviewError,
    )
  })

  it('times out, throws ReviewError and terminates the child with SIGTERM first', async () => {
    await setup()
    const pidOut = join(dir, 'pid')
    const signalOut = join(dir, 'signal')
    process.env.FAKE_CLAUDE_MODE = 'hang'
    process.env.FAKE_CLAUDE_PID_OUT = pidOut
    process.env.FAKE_CLAUDE_SIGNAL_OUT = signalOut
    const started = Date.now()
    const err = await reviewBatch(inputs, { ...base(), timeoutMs: 500 }).catch((e: unknown) => e)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toMatch(/timed out/i)

    const pid = Number(await readFile(pidOut, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    expect(await isAlive(pid)).toBe(false)
    expect(await readFile(signalOut, 'utf8')).toBe('SIGTERM')
  })

  it('escalates to SIGKILL when the child ignores SIGTERM past the grace period', async () => {
    await setup()
    const pidOut = join(dir, 'pid')
    const signalOut = join(dir, 'signal')
    process.env.FAKE_CLAUDE_MODE = 'hang-ignore-sigterm'
    process.env.FAKE_CLAUDE_PID_OUT = pidOut
    process.env.FAKE_CLAUDE_SIGNAL_OUT = signalOut
    const err = await reviewBatch(inputs, { ...base(), timeoutMs: 300, killGraceMs: 200 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReviewError)

    const pid = Number(await readFile(pidOut, 'utf8'))
    expect(await isAlive(pid)).toBe(false)
    expect(await readFile(signalOut, 'utf8')).toBe('SIGTERM')
  })
})

describe('mapResults', () => {
  it('maps by id, so keys containing control characters never round-trip through the model', () => {
    const payload = {
      results: [
        { id: 2, text: ['Yayımlandı'], fuzzy: false, reason: 'ok' },
        { id: 1, text: ['Kaydet'], fuzzy: true, reason: 'check' },
      ],
    }
    const out = mapResults(inputs.slice(0, 2), payload, 2)
    expect(out).toEqual([
      { key: 'Save changes', text: ['Kaydet'], fuzzy: true, reason: 'check' },
      { key: CTX_KEY, text: ['Yayımlandı'], fuzzy: false, reason: 'ok' },
    ])
  })
})
