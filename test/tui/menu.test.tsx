import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { App } from '../../src/tui/App.js'
import { ESC_DELAY, fakeCommands, keys, makeHome, tick, waitForText, render, type Home } from './helpers.js'

let home: Home
let cwd: string

beforeEach(async () => {
  home = await makeHome()
  cwd = join(home.path, 'work')
  await mkdir(cwd)
  await writeFile(join(cwd, 'plugin.po'), '')
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

const MENU_ITEMS = [
  'Translate a .po file',
  'Review a submitted .po',
  'Import Translation Memory (.tmx)',
  /Sync .*glossary/,
  'Configure API keys',
]

describe('Menu', () => {
  it('lists the five actions with the first one highlighted', async () => {
    const { lastFrame } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    const frame = lastFrame() ?? ''
    for (const item of MENU_ITEMS) {
      if (typeof item === 'string') expect(frame).toContain(item)
      else expect(frame).toMatch(item)
    }
    expect(frame).toMatch(/❯ Translate a \.po file/)
  })

  it('opens the translate file picker on enter', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'plugin.po')
    expect(lastFrame()).toContain(cwd)
  })

  it('reaches the review picker with the arrow keys', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'Review')
    expect(lastFrame()).toContain('plugin.po')
  })

  it('reaches the TM import picker with the arrow keys', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    for (let i = 0; i < 2; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, /\.tmx/)
    expect(lastFrame()).not.toContain('plugin.po')
  })

  it('reaches the glossary sync screen', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, /[Ll]ocale/)
    expect(lastFrame()).toContain('tr')
  })

  it('reaches the API key screen', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    for (let i = 0; i < 4; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'DEEPL_API_KEY')
    expect(lastFrame()).toContain('(not set)')
  })

  it('returns to the menu with q and with escape', async () => {
    const { lastFrame, stdin } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'plugin.po')

    stdin.write('q')
    await waitForText(lastFrame, 'Configure API keys')

    stdin.write(keys.enter)
    await waitForText(lastFrame, 'plugin.po')
    stdin.write(keys.esc)
    await tick(ESC_DELAY)
    await waitForText(lastFrame, 'Configure API keys')
  })

  it('exits the app when q is pressed on the menu', async () => {
    let exited = false
    const { stdin } = render(<App commands={fakeCommands()} cwd={cwd} onExit={() => (exited = true)} />)
    await tick()
    stdin.write('q')
    await tick()
    expect(exited).toBe(true)
  })
})
