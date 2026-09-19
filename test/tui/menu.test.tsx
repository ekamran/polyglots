import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { App } from '../../src/tui/App.js'
import { MENU_ITEMS, type MenuAction } from '../../src/tui/screens/Menu.js'
import { ESC_DELAY, fakeCommands, keys, makeHome, tick, waitForText, render, type Home } from './helpers.js'

// How many times to press down to land on an action. Derived rather than
// counted by hand: a new menu item used to shift every index below it and
// break these tests for a reason that had nothing to do with what they test.
function hopsTo(action: MenuAction): number {
  const at = MENU_ITEMS.findIndex((item) => item.value === action)
  if (at < 0) throw new Error(`no menu item for ${action}`)
  return at
}

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

// Written out rather than derived from MENU_ITEMS, because this is the
// assertion about what the user sees and deriving it would make it agree with
// the code by construction. The length check below is what stops it drifting.
const EXPECTED_LABELS = [
  'Translate a .po file',
  'Review a submitted .po',
  'Review statistics',
  'Import Translation Memory (.tmx)',
  /Sync .*glossary/,
  'Configure API keys',
]

describe('Menu', () => {
  it('lists every action with the first one highlighted', async () => {
    const { lastFrame } = render(<App commands={fakeCommands()} cwd={cwd} />)
    await tick()
    const frame = lastFrame() ?? ''
    for (const item of EXPECTED_LABELS) {
      if (typeof item === 'string') expect(frame).toContain(item)
      else expect(frame).toMatch(item)
    }
    // Adding a menu item without listing it here should fail, not pass quietly:
    // containment alone never notices something new.
    expect(EXPECTED_LABELS).toHaveLength(MENU_ITEMS.length)
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
    for (let i = 0; i < hopsTo('import-tm'); i++) {
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
    for (let i = 0; i < hopsTo('sync-glossary'); i++) {
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
    for (let i = 0; i < hopsTo('configure-keys'); i++) {
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
