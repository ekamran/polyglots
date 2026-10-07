import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { App } from '../../src/tui/App.js'
import type { AgentStatus } from '../../src/agent/discover.js'
import {
  agentStatus,
  ESC_DELAY,
  fakeCommands,
  flat,
  openFromHome,
  keys,
  makeHome,
  tick,
  unusableAgent,
  waitForText,
  render,
  cleanup,
  type Home,
} from './helpers.js'

let home: Home

beforeEach(async () => {
  home = await makeHome()
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

async function openAgents(stdin: { write(data: string): void }, lastFrame: () => string) {
  await tick()
  await openFromHome(stdin, 'agents')
  await waitForText(lastFrame, 'r re-check')
}

describe('Check AI agents', () => {
  it('shows what was found for each provider', async () => {
    const statuses: AgentStatus[] = [
      agentStatus('claude', { auth: { state: 'signed-in', detail: 'claude.ai' }, version: '2.1.292 (Claude Code)' }),
      agentStatus('antigravity', {
        binSource: 'POLYGLOTS_AGENT_BIN',
        auth: { state: 'unknown', detail: 'no token file' },
        model: 'Gemini 3.8 Flash (Medium)',
        notes: ['binary from POLYGLOTS_AGENT_BIN', 'sign-in unknown: no token file'],
      }),
    ]
    const { lastFrame, stdin } = render(<App commands={fakeCommands({ discoverAgents: async () => statuses })} />)
    await openAgents(stdin, lastFrame)
    const frame = flat(lastFrame())
    expect(frame).toContain('claude ready')
    expect(frame).toContain('/opt/bin/claude')
    expect(frame).toContain('2.1.292 (Claude Code)')
    expect(frame).toContain('signed in (claude.ai)')
    expect(frame).toContain('antigravity ready')
    expect(frame).toContain('POLYGLOTS_AGENT_BIN')
    expect(frame).toContain('Gemini 3.8 Flash (Medium)')
    expect(frame).toContain('sign-in unknown: no token file')
  })

  it('names the reason an agent is unavailable', async () => {
    const statuses = [agentStatus('claude'), unusableAgent('antigravity', 'agy not on PATH')]
    const { lastFrame, stdin } = render(<App commands={fakeCommands({ discoverAgents: async () => statuses })} />)
    await openAgents(stdin, lastFrame)
    const frame = flat(lastFrame())
    expect(frame).toContain('antigravity unavailable')
    expect(frame).toContain('agy not on PATH')
  })

  // The menu reads the same state, so a re-check here is what it shows after.
  it('re-checks with r, and the menu agrees after esc', async () => {
    let installed = false
    const discoverAgents = vi.fn(async () => [
      agentStatus('claude'),
      installed ? agentStatus('antigravity') : unusableAgent('antigravity', 'agy not on PATH'),
    ])
    const { lastFrame, stdin } = render(<App commands={fakeCommands({ discoverAgents })} />)
    await openAgents(stdin, lastFrame)
    expect(flat(lastFrame())).toContain('agy not on PATH')

    installed = true
    stdin.write('r')
    await waitForText(() => flat(lastFrame()), 'antigravity ready')
    expect(discoverAgents).toHaveBeenLastCalledWith({ refresh: true })

    stdin.write(keys.esc)
    await tick(ESC_DELAY)
    await waitForText(lastFrame, 'Configure API keys')
    expect(lastFrame()).not.toContain('Unavailable')
  })

  it('shows a failed check with a way to retry', async () => {
    let fail = true
    const discoverAgents = vi.fn(async () => {
      if (fail) throw new Error('spawn EPERM')
      return [agentStatus('claude'), agentStatus('antigravity')]
    })
    const { lastFrame, stdin } = render(<App commands={fakeCommands({ discoverAgents })} />)
    await openAgents(stdin, lastFrame)
    expect(flat(lastFrame())).toContain('Could not check agents: spawn EPERM')

    fail = false
    stdin.write('r')
    await waitForText(() => flat(lastFrame()), 'claude ready')
    expect(lastFrame()).not.toContain('Could not check agents')
  })
})
