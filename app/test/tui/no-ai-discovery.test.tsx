import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { saveConfig } from '../../src/config.js'
import { App } from '../../src/tui/App.js'
import { cleanup, fakeCommands, makeHome, openFromHome, render, tick, waitFor, type Home } from './helpers.js'

let home: Home
beforeEach(async () => {
  home = await makeHome()
})
afterEach(async () => {
  cleanup()
  await home.cleanup()
})

// With No AI chosen, nothing will run an agent, so launching the app must not
// spawn every agent CLI to ask whether it is signed in; doctor skips it for
// the same reason. Opening setup asks again, since that is where someone
// would switch to an agent.
describe('agent discovery with No AI', () => {
  it('does not run at launch', async () => {
    saveConfig({ defaultLocale: 'tr', reviewProvider: 'none' })
    const commands = fakeCommands()
    render(<App commands={commands} />)
    await tick(50)
    expect(commands.discoverAgents).not.toHaveBeenCalled()
  })

  it('runs when setup is opened, so an agent can still be chosen', async () => {
    saveConfig({ defaultLocale: 'tr', reviewProvider: 'none' })
    const commands = fakeCommands()
    const view = render(<App commands={commands} />)
    await tick(50)
    await openFromHome(view.stdin, 'setup')
    await waitFor(() => vi.mocked(commands.discoverAgents).mock.calls.length > 0)
  })

  it('still runs at launch for an agent provider', async () => {
    saveConfig({ defaultLocale: 'tr', reviewProvider: 'claude' })
    const commands = fakeCommands()
    render(<App commands={commands} />)
    await waitFor(() => vi.mocked(commands.discoverAgents).mock.calls.length > 0)
  })
})
