import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { saveConfig } from '../../src/config.js'
import type { TranslateOptions } from '../../src/commands/translate.js'
import { CommandsProvider } from '../../src/tui/commands.js'
import { Translate } from '../../src/tui/screens/Translate.js'
import { ESC_DELAY, fakeCommands, flat, keys, makeHome, render, scriptedTranslate, tick, waitFor, waitForText, type Home } from './helpers.js'

let home: Home
let cwd: string
let poFile: string

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  poFile = join(cwd, 'plugin-tr.po')
  await writeFile(poFile, '')
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

function mount(commands = fakeCommands(), onBack: () => void = () => undefined) {
  return render(
    <CommandsProvider value={commands}>
      <Translate cwd={cwd} onBack={onBack} />
    </CommandsProvider>,
  )
}

async function pickFile(stdin: { write(data: string): void }, lastFrame: () => string | undefined) {
  await waitForText(lastFrame, 'plugin-tr.po')
  stdin.write(keys.down)
  await tick()
  stdin.write(keys.enter)
  await waitForText(lastFrame, /Draft engine/)
}

describe('Translate options', () => {
  it('defaults to the configured engine and locale', async () => {
    saveConfig({ defaultDraftEngine: 'openai', defaultLocale: 'de' })
    const { lastFrame, stdin } = mount()
    await pickFile(stdin, lastFrame)
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/Draft engine:\s+openai/)
    expect(frame).toMatch(/Locale:\s+de/)
    expect(frame).toMatch(/Mode:\s+pending/)
  })

  it('toggles mode and engine with the arrow keys', async () => {
    const { lastFrame, stdin } = mount()
    await pickFile(stdin, lastFrame)
    stdin.write(keys.right)
    await waitForText(lastFrame, /Mode:\s+all/)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.right)
    await waitForText(lastFrame, /Draft engine:\s+openai/)
    stdin.write(keys.left)
    await waitForText(lastFrame, /Draft engine:\s+deepl/)
  })
})

describe('Translate run', () => {
  it('passes the chosen options to translateFile and shows the summary', async () => {
    const calls: TranslateOptions[] = []
    const commands = fakeCommands({
      translateFile: vi.fn(async (opts: TranslateOptions) => {
        calls.push(opts)
        return scriptedTranslate((file) => [
          { type: 'start', file, total: 8, pending: 3 },
          { type: 'tm-hit', count: 1 },
          { type: 'batch-start', index: 1, of: 1, size: 2, at: Date.now() },
          { type: 'batch-done', index: 1, translated: 2, fuzzy: 1, at: Date.now() },
          { type: 'saved' },
          { type: 'done', summary: { file, total: 8, pending: 3, fromTm: 1, translated: 2, fuzzy: 1, skipped: 0 } },
        ])(opts)
      }),
    })
    let back = 0
    const { lastFrame, stdin } = mount(commands, () => back++)
    await pickFile(stdin, lastFrame)

    stdin.write(keys.right)
    await waitForText(lastFrame, /Mode:\s+all/)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write('_TR ')
    await waitForText(lastFrame, /Locale:\s+tr_TR/)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'Done. 2 translated, 1 fuzzy, 1 from TM, 0 skipped.')
    expect(flat(lastFrame())).toContain(`Open ${poFile} in PoEdit to review.`)
    await waitForText(lastFrame, 'enter/q back to menu')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ file: poFile, mode: 'all', draftEngine: 'deepl', locale: 'tr' })
    expect(typeof calls[0]!.onProgress).toBe('function')

    stdin.write(keys.enter)
    await tick()
    expect(back).toBe(1)
  })



  it('ignores q and escape while a run is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const commands = fakeCommands({
      translateFile: vi.fn(async (opts: TranslateOptions) => {
        opts.onProgress?.({ type: 'start', file: opts.file, total: 4, pending: 2 })
        await gate
        const summary = { file: opts.file, total: 4, pending: 2, fromTm: 0, translated: 2, fuzzy: 0, skipped: 0 }
        opts.onProgress?.({ type: 'done', summary })
        return summary
      }),
    })
    let back = 0
    const { lastFrame, stdin } = mount(commands, () => back++)
    await pickFile(stdin, lastFrame)
    for (let i = 0; i < 4; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, /0\/2/)

    stdin.write('q')
    stdin.write(keys.esc)
    await tick(ESC_DELAY)
    expect(back).toBe(0)

    release()
    await waitForText(lastFrame, 'Done. 2 translated')
    stdin.write('q')
    await tick()
    expect(back).toBe(1)
  })

  it('shows the error when translateFile rejects', async () => {
    const commands = fakeCommands({
      translateFile: vi.fn(async () => {
        throw new Error('DEEPL_API_KEY is not set')
      }),
    })
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    for (let i = 0; i < 4; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'DEEPL_API_KEY is not set')
  })
})

/**
 * Translate asked twice: once on "Start translation" and again at a [y/N].
 * Review asks once, and so does the translate command, whose confirmation is
 * scoped to --all (cli.ts: `flags.all === true && flags.yes !== true`). The
 * second question only earns its place on the mode that overwrites entries
 * that already have a translation, in a file translate saves in place.
 */
describe('Translate starting a run', () => {
  it('starts a pending run straight from the options, with no confirmation', async () => {
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    for (let i = 0; i < 4; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)

    await waitFor(() => (commands.translateFile as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    expect(lastFrame()).not.toContain('[y/N]')
    expect((commands.translateFile as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ mode: 'pending' })
  })

  // The review pass of a translate run spawns the configured provider, so it
  // must run the binary discovery checked, not whatever is first on PATH.
  it('runs the agent binary named by POLYGLOTS_AGENT_BIN', async () => {
    vi.stubEnv('POLYGLOTS_AGENT_BIN', '/opt/claude/bin/claude')
    try {
      const commands = fakeCommands()
      const { lastFrame, stdin } = mount(commands)
      await pickFile(stdin, lastFrame)
      for (let i = 0; i < 4; i++) {
        stdin.write(keys.down)
        await tick()
      }
      stdin.write(keys.enter)

      await waitFor(() => (commands.translateFile as ReturnType<typeof vi.fn>).mock.calls.length > 0)
      expect((commands.translateFile as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
        bin: '/opt/claude/bin/claude',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  /**
   * `all` does not ask either. Choosing it is the choice, and it is spelled out
   * on the screen where it is made: re-translating entries that already have a
   * translation is the point of the mode, not a mistake to be caught on the way
   * out.
   */
  it('starts an all run without asking, having said what it will do', async () => {
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    stdin.write(keys.right)
    await waitForText(lastFrame, /Mode:\s+all/)
    // Said on the options screen, where the mode is chosen.
    expect(flat(lastFrame())).toMatch(/re-translate already-translated entries/i)

    for (let i = 0; i < 4; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)

    await waitFor(() => (commands.translateFile as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    expect(lastFrame()).not.toContain('[y/N]')
    expect((commands.translateFile as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ mode: 'all' })
  })
})

/**
 * translateFile has taken a batch size since it had batches, the CLI has
 * --batch-size, and review's screen has offered the choice for releases. This
 * screen never passed one, so a translate run in the TUI was stuck on the
 * configured default however large the file.
 */
describe('Translate batch size', () => {
  it('offers the batch size and passes the chosen one to translateFile', async () => {
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    expect(flat(lastFrame())).toMatch(/Batch size:\s+25/)

    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.right)
    await waitForText(lastFrame, /Batch size:\s+50/)
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)

    await waitFor(() => (commands.translateFile as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    expect((commands.translateFile as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ batchSize: 50 })
  })
})
