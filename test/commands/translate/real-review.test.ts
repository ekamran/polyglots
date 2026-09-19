import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { translateFile } from '../../../src/commands/translate.js'
import { CTX, collect, entryOf, fakeClaude, fakeEngine, makeWorkspace, ofType, parseFile, type Workspace } from './helpers.js'

let ws: Workspace
const savedEnv = { ...process.env }

const HOOK_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: tr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Save Changes"
msgstr ""

msgid "Hook name"
msgstr ""
`

beforeEach(async () => {
  ws = await makeWorkspace()
})

afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
  await ws.cleanup()
})

describe('translateFile with the real reviewBatch and the fake claude binary', () => {
  it('drives claude -p per batch and writes its output back', async () => {
    const mcpConfigPath = join(ws.home, 'mcp.json')
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }))
    const argsOut = join(ws.home, 'args.json')
    process.env.FAKE_CLAUDE_ARGS_OUT = argsOut
    const { events, onProgress } = collect()

    const summary = await translateFile({
      file: ws.file,
      locale: 'tr',
      mode: 'pending',
      draftEngine: 'deepl',
      engine: fakeEngine(),
      bin: fakeClaude,
      mcpConfigPath,
      batchSize: 4,
      onProgress,
    })

    expect(summary).toMatchObject({ pending: 7, translated: 7, fromTm: 0, skipped: 0, fuzzy: 0 })
    expect(ofType(events, 'batch-done')).toHaveLength(2)

    const after = await parseFile(ws.file)
    expect(entryOf(after, 'Save Changes').msgstr).toEqual(['[tr] Save Changes'])
    expect(entryOf(after, `post type singular name${CTX}Form`).msgstr).toEqual(['[tr] Form'])
    expect(entryOf(after, 'One submission was deleted.').msgstr).toEqual([
      '[tr] One submission was deleted.',
      '[tr] %d submissions were deleted.',
    ])

    const argv = JSON.parse(await readFile(argsOut, 'utf8')) as string[]
    expect(argv[argv.indexOf('--mcp-config') + 1]).toBe(mcpConfigPath)
  })

  it('writes the fuzzy flag when claude marks a result fuzzy and counts it in the summary', async () => {
    const mcpConfigPath = join(ws.home, 'mcp.json')
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }))
    const file = join(ws.home, 'hooks.po')
    await writeFile(file, HOOK_PO)
    const { events, onProgress } = collect()

    const summary = await translateFile({
      file,
      locale: 'tr',
      mode: 'pending',
      draftEngine: 'deepl',
      engine: fakeEngine(),
      bin: fakeClaude,
      mcpConfigPath,
      batchSize: 4,
      onProgress,
    })

    expect(summary).toMatchObject({ pending: 2, translated: 2, fuzzy: 1, skipped: 0 })
    expect(ofType(events, 'batch-done')).toMatchObject([{ type: 'batch-done', index: 1, translated: 2, fuzzy: 1 }])
    const after = await parseFile(file)
    expect(entryOf(after, 'Hook name').msgstr).toEqual(['[tr] Hook name'])
    expect(entryOf(after, 'Hook name').comments?.flag).toBe('fuzzy')
    expect(entryOf(after, 'Save Changes').comments?.flag).toBeUndefined()
  })

  it('skips a batch after two failing claude runs and keeps going', async () => {
    const mcpConfigPath = join(ws.home, 'mcp.json')
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }))
    process.env.FAKE_CLAUDE_MODE = 'exit1'
    const { events, onProgress } = collect()

    const summary = await translateFile({
      file: ws.file,
      locale: 'tr',
      mode: 'pending',
      draftEngine: 'deepl',
      engine: fakeEngine(),
      bin: fakeClaude,
      mcpConfigPath,
      batchSize: 4,
      onProgress,
    })

    expect(summary).toMatchObject({ pending: 7, translated: 0, skipped: 7 })
    const skipped = ofType(events, 'batch-skipped')
    expect(skipped.map((e) => e.index)).toEqual([1, 2])
    expect(skipped[0]!.reason).toMatch(/exit code 1/)
    expect(await readFile(ws.file)).toEqual(ws.original)
    expect(ofType(events, 'saved')).toEqual([])
  })
})
