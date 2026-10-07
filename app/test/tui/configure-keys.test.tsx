import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { saveSecret } from '../../src/config.js'
import { secretsFile } from '../../src/paths.js'
import { ConfigureKeys } from '../../src/tui/screens/ConfigureKeys.js'
import { CommandsProvider } from '../../src/tui/commands.js'
import { fakeCommands, keys, makeHome, tick, waitForText, render, cleanup, type Home } from './helpers.js'

let home: Home

beforeEach(async () => {
  home = await makeHome()
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

const EXISTING_DEEPL = 'deepl-existing-key-1234567890:fx'
const NEW_OPENAI = 'sk-brandnewopenaikey0987654321'

function mount(onBack: () => void = () => undefined, commands = fakeCommands()) {
  return render(
    <CommandsProvider value={commands}>
      <ConfigureKeys onBack={onBack} />
    </CommandsProvider>,
  )
}

describe('ConfigureKeys', () => {
  it('shows existing keys masked and never the raw value', async () => {
    saveSecret('DEEPL_API_KEY', EXISTING_DEEPL)
    const { lastFrame, frames } = mount()
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('DEEPL_API_KEY')
    expect(frame).toContain('deep…fx')
    expect(frame).toContain('OPENAI_API_KEY')
    expect(frame).toContain('(not set)')
    for (const f of frames) expect(f).not.toContain(EXISTING_DEEPL)
  })

  it('keeps an existing key on blank input and saves a typed one masked', async () => {
    saveSecret('DEEPL_API_KEY', EXISTING_DEEPL)
    const { lastFrame, frames, stdin } = mount()
    await tick()

    stdin.write(keys.enter)
    await waitForText(lastFrame, /DEEPL_API_KEY.*(kept|unchanged)/)

    stdin.write(NEW_OPENAI)
    await tick()
    expect(lastFrame()).toContain('*'.repeat(NEW_OPENAI.length))
    stdin.write(keys.enter)
    await waitForText(lastFrame, /OPENAI_API_KEY.*saved/)

    const env = await readFile(secretsFile(), 'utf8')
    expect(env).toContain(`DEEPL_API_KEY=${EXISTING_DEEPL}`)
    expect(env).toContain(`OPENAI_API_KEY=${NEW_OPENAI}`)
    expect(lastFrame()).toContain('sk-b…21')
    for (const f of frames) {
      expect(f).not.toContain(NEW_OPENAI)
      expect(f).not.toContain(EXISTING_DEEPL)
    }
  })

  it('survives an unreadable secrets file and shows the error instead of crashing', async () => {
    const commands = fakeCommands({
      loadSecrets: vi.fn(() => {
        throw new Error('EACCES: permission denied')
      }),
    })
    const { lastFrame, frames, stdin } = mount(() => undefined, commands)
    await waitForText(lastFrame, /EACCES: permission denied/)
    expect(lastFrame()).toContain('DEEPL_API_KEY')
    expect(lastFrame()).toContain('(not set)')
    stdin.write(keys.enter)
    await waitForText(lastFrame, /DEEPL_API_KEY.*(kept|unchanged)/)
    for (const f of frames) expect(f).not.toContain('ErrorBoundary')
  })

  it('flags a key that comes from the environment, since it overrides the file', async () => {
    process.env.OPENAI_API_KEY = 'sk-fromenvironment1234567890'
    saveSecret('OPENAI_API_KEY', NEW_OPENAI)
    const { lastFrame, frames } = mount()
    await waitForText(lastFrame, /OPENAI_API_KEY.*sk-f…90.*env/)
    expect(lastFrame()).not.toMatch(/DEEPL_API_KEY.*env/)
    for (const f of frames) {
      expect(f).not.toContain('sk-fromenvironment1234567890')
      expect(f).not.toContain(NEW_OPENAI)
    }
  })

  it('does not treat q inside the key field as back', async () => {
    let back = 0
    const { lastFrame, stdin } = mount(() => back++)
    await tick()
    stdin.write('q')
    await tick()
    expect(back).toBe(0)
    expect(lastFrame()).toContain('*')
  })

  it('returns to the menu with enter after the last key', async () => {
    let back = 0
    const { lastFrame, stdin } = mount(() => back++)
    await tick()
    stdin.write(keys.enter)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, /OPENAI_API_KEY.*(kept|unchanged)/)
    stdin.write(keys.enter)
    await tick()
    expect(back).toBe(1)
  })
})
