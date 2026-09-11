import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { saveConfig } from '../../src/config.js'
import type { TranslateOptions } from '../../src/commands/translate.js'
import { CommandsProvider } from '../../src/tui/commands.js'
import { Translate } from '../../src/tui/screens/Translate.js'
import { ESC_DELAY, fakeCommands, flat, keys, makeHome, render, scriptedTranslate, tick, waitForText, type Home } from './helpers.js'

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
    stdin.write(keys.enter)
    await waitForText(lastFrame, /re-translate/)
    expect(lastFrame()).toContain('[y/N]')
    expect(lastFrame()).toContain('locale tr-tr')

    stdin.write('y')
    await waitForText(lastFrame, 'Done. 2 translated, 1 fuzzy, 1 from TM, 0 skipped.')
    expect(flat(lastFrame())).toContain(`Open ${poFile} in PoEdit to review.`)
    await waitForText(lastFrame, 'enter/q back to menu')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ file: poFile, mode: 'all', draftEngine: 'deepl', locale: 'tr-tr' })
    expect(typeof calls[0]!.onProgress).toBe('function')

    stdin.write(keys.enter)
    await tick()
    expect(back).toBe(1)
  })

  it('cancels at the confirmation with n and returns to the options', async () => {
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, '[y/N]')
    stdin.write('n')
    await waitForText(lastFrame, /Draft engine/)
    expect(commands.translateFile).not.toHaveBeenCalled()
  })

  it('treats enter at the confirmation as No, so a double enter never starts an all run', async () => {
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await pickFile(stdin, lastFrame)
    stdin.write(keys.right)
    await waitForText(lastFrame, /Mode:\s+all/)
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, '[y/N]')
    stdin.write(keys.enter)
    await waitForText(lastFrame, /Draft engine/)
    expect(commands.translateFile).not.toHaveBeenCalled()
    expect(lastFrame()).not.toContain('[y/N]')
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
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, '[y/N]')
    stdin.write('y')
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
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, '[y/N]')
    stdin.write('y')
    await waitForText(lastFrame, 'DEEPL_API_KEY is not set')
  })
})
