import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { App } from '../../src/tui/App.js'
import { DEFAULT_CONFIG } from '../../src/config.js'
import type { PolyglotsConfig } from '../../src/types.js'
import { MENU_ITEMS, nextProvider } from '../../src/tui/screens/Menu.js'
import {
  agentStatus,
  ESC_DELAY,
  fakeCommands,
  flat,
  hopsTo,
  keys,
  makeHome,
  tick,
  unusableAgent,
  waitForText,
  render,
  type Home,
} from './helpers.js'


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
  'Fetch from translate.wordpress.org',
  'Split a .po into parts',
  'Review statistics',
  'Import Translation Memory (.tmx or .po)',
  'Export Translation Memory',
  /Sync .*glossary/,
  'Locale rules',
  'Check AI agents',
  'Local models',
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
    await waitForText(lastFrame, /Import Translation Memory \(\.tmx or \.po\)/)
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

describe('switching the review provider', () => {
  it('shows the provider the config names', async () => {
    const commands = fakeCommands({
      loadConfig: () => ({ ...DEFAULT_CONFIG, reviewProvider: 'antigravity' }),
    })
    const { lastFrame } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    expect(lastFrame() ?? '').toContain('Provider: antigravity')
  })

  it('cycles with p and saves the choice', async () => {
    const saved: Partial<PolyglotsConfig>[] = []
    const commands = fakeCommands({
      loadConfig: () => ({ ...DEFAULT_CONFIG, reviewProvider: 'claude' }),
      saveConfig: (patch: Partial<PolyglotsConfig>) => {
        saved.push(patch)
        return { ...DEFAULT_CONFIG, ...patch }
      },
    })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    expect(lastFrame() ?? '').toContain('Provider: claude')

    stdin.write('p')
    await tick()
    expect(saved).toEqual([{ reviewProvider: 'antigravity' }])
    expect(lastFrame() ?? '').toContain('Provider: antigravity')

    // Wraps, so one key reaches every provider however many there are.
    stdin.write('p')
    await tick()
    expect(lastFrame() ?? '').toContain('Provider: claude')
  })

  // A run reads the saved config, so moving the display on a failed save would
  // name an agent no review is going to use.
  it('keeps showing the saved provider when the write fails, and says why', async () => {
    const commands = fakeCommands({
      loadConfig: () => ({ ...DEFAULT_CONFIG, reviewProvider: 'claude' }),
      saveConfig: () => {
        throw new Error('EACCES: permission denied')
      },
    })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    stdin.write('p')
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Provider: claude')
    expect(frame).toMatch(/EACCES/)
  })
})

describe('switching only between usable agents', () => {
  function recorder(reviewProvider: 'claude' | 'antigravity') {
    const saved: Partial<PolyglotsConfig>[] = []
    let current: PolyglotsConfig = { ...DEFAULT_CONFIG, reviewProvider }
    return {
      saved,
      loadConfig: () => current,
      saveConfig: (patch: Partial<PolyglotsConfig>) => {
        saved.push(patch)
        current = { ...current, ...patch }
        return current
      },
    }
  }

  it('leaves claude selected when antigravity is unusable, and says why', async () => {
    const config = recorder('claude')
    const commands = fakeCommands({
      ...config,
      discoverAgents: async () => [agentStatus('claude'), unusableAgent('antigravity', 'agy not on PATH')],
    })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await waitForText(lastFrame, 'Unavailable: antigravity (agy not on PATH)')
    stdin.write('p')
    await tick()
    const frame = flat(lastFrame())
    expect(config.saved).toEqual([])
    expect(frame).toContain('Provider: claude')
    expect(frame).toContain('No other usable agent: antigravity: agy not on PATH')
  })

  it('switches and saves when both are usable', async () => {
    const config = recorder('claude')
    const commands = fakeCommands({ ...config })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    stdin.write('p')
    await tick()
    expect(config.saved).toEqual([{ reviewProvider: 'antigravity' }])
    expect(lastFrame()).toContain('Provider: antigravity')
    expect(lastFrame()).not.toContain('Unavailable')
  })

  // The menu never rewrites the configured provider: switching it silently
  // would change which engine a run records, behind the person's back.
  it('shows why the configured provider is unusable, and p goes to the usable one and back', async () => {
    const config = recorder('antigravity')
    const reason = 'antigravity is missing permission rules: mcp(polyglots/tm_lookup) (see docs/antigravity.md)'
    const commands = fakeCommands({
      ...config,
      discoverAgents: async () => [agentStatus('claude'), agentStatus('antigravity', { usable: false, reason })],
    })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await waitForText(() => flat(lastFrame()), 'missing permission rules')
    expect(lastFrame()).toContain('Provider: antigravity')
    expect(config.saved).toEqual([])

    stdin.write('p')
    await tick()
    expect(lastFrame()).toContain('Provider: claude')
    stdin.write('p')
    await tick()
    expect(lastFrame()).toContain('Provider: antigravity')
    expect(config.saved).toEqual([{ reviewProvider: 'claude' }, { reviewProvider: 'antigravity' }])
  })

  it('cycles every provider while discovery is still running, and says it is checking', async () => {
    const config = recorder('claude')
    const commands = fakeCommands({ ...config, discoverAgents: () => new Promise(() => {}) })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    expect(lastFrame()).toContain('Checking agents…')
    stdin.write('p')
    await tick()
    expect(config.saved).toEqual([{ reviewProvider: 'antigravity' }])
  })

  it('behaves like the old menu when discovery fails', async () => {
    const config = recorder('claude')
    const commands = fakeCommands({ ...config, discoverAgents: async () => Promise.reject(new Error('spawn EPERM')) })
    const { lastFrame, stdin } = render(<App commands={commands} cwd={cwd} />)
    await tick()
    await tick()
    expect(lastFrame()).not.toContain('Checking agents…')
    stdin.write('p')
    await tick()
    expect(config.saved).toEqual([{ reviewProvider: 'antigravity' }])
  })
})

describe('nextProvider', () => {
  it('cycles every provider when nothing is known about which are usable', () => {
    expect(nextProvider('claude')).toBe('antigravity')
    expect(nextProvider('antigravity')).toBe('claude')
  })

  it('keeps the current provider in the rotation even when it is not usable', () => {
    expect(nextProvider('antigravity', ['claude'])).toBe('claude')
    expect(nextProvider('claude', ['claude', 'antigravity'])).toBe('antigravity')
  })

  it('stays put when the current provider is the only one', () => {
    expect(nextProvider('claude', ['claude'])).toBe('claude')
    expect(nextProvider('claude', [])).toBe('claude')
  })
})
