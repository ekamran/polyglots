import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { main, type CliDeps } from '../../src/cli.js'
import { loadConfig, saveConfig } from '../../src/config.js'
import { readUsageState, usageStateFile } from '../../src/usage/index.js'
import { buildUsagePayload } from '../../src/usage/payload.js'
import { VERSION } from '../../src/version.js'

interface Sink {
  text: string
  isTTY: boolean
  write(chunk: string): boolean
}

function sink(): Sink {
  return {
    text: '',
    isTTY: false,
    write(chunk: string) {
      this.text += chunk
      return true
    },
  }
}

async function run(argv: string[], deps: CliDeps = {}) {
  const stdout = sink()
  const stderr = sink()
  const stdin = new PassThrough()
  stdin.end()
  // A spy by default, so no test here can start a real send.
  const sendUsage = vi.fn()
  const code = await main(argv, { env: {}, sendUsage, ...deps, streams: { stdin, stdout, stderr } })
  return { code, out: stdout.text, err: stderr.text, sendUsage }
}

let savedDnt: string | undefined

beforeEach(() => {
  savedDnt = process.env.DO_NOT_TRACK
  delete process.env.DO_NOT_TRACK
})

afterEach(() => {
  if (savedDnt === undefined) delete process.env.DO_NOT_TRACK
  else process.env.DO_NOT_TRACK = savedDnt
})

describe('usage-stats show', () => {
  it('prints exactly the next payload when the setting is on', async () => {
    saveConfig({ usageStats: true })
    const { code, out } = await run(['usage-stats', 'show'])
    expect(code).toBe(0)
    const id = readUsageState()!.installId
    expect(JSON.parse(out)).toEqual(buildUsagePayload({ installId: id, version: VERSION }))
  })

  it('says nothing is sent, and makes no install id, while no answer is recorded', async () => {
    const { code, out, err } = await run(['usage-stats', 'show'])
    expect(code).toBe(0)
    expect(err).toMatch(/off/i)
    expect(err).toContain('polyglots config set usageStats on')
    // The preview still shows what would go, under a placeholder id.
    expect(JSON.parse(out).installId).not.toMatch(/^[0-9a-f]{8}-/)
    expect(existsSync(usageStateFile())).toBe(false)
  })

  it('names DO_NOT_TRACK when it is what turns the setting off', async () => {
    saveConfig({ usageStats: true })
    process.env.DO_NOT_TRACK = '1'
    const { code, err } = await run(['usage-stats', 'show'])
    expect(code).toBe(0)
    expect(err).toContain('DO_NOT_TRACK')
    expect(existsSync(usageStateFile())).toBe(false)
  })
})

describe('usage-stats reset', () => {
  it('forgets the install id, and the next payload carries a new one', async () => {
    saveConfig({ usageStats: true })
    await run(['usage-stats', 'show'])
    const first = readUsageState()!.installId
    const { code } = await run(['usage-stats', 'reset'])
    expect(code).toBe(0)
    expect(existsSync(usageStateFile())).toBe(false)
    const { out } = await run(['usage-stats', 'show'])
    expect(JSON.parse(out).installId).not.toBe(first)
  })
})

describe('config set usageStats', () => {
  it('takes on and off, and refuses anything else', async () => {
    expect((await run(['config', 'set', 'usageStats', 'on'])).code).toBe(0)
    expect(loadConfig().usageStats).toBe(true)
    expect((await run(['config', 'get', 'usageStats'])).out.trim()).toBe('on')
    expect((await run(['config', 'set', 'usageStats', 'off'])).code).toBe(0)
    expect(loadConfig().usageStats).toBe(false)
    expect((await run(['config', 'get', 'usageStats'])).out.trim()).toBe('off')
    expect((await run(['config', 'set', 'usageStats', 'maybe'])).code).toBe(2)
    expect(loadConfig().usageStats).toBe(false)
  })

  it('turning it on makes no request by itself', async () => {
    const { sendUsage } = await run(['config', 'set', 'usageStats', 'on'])
    expect(sendUsage).not.toHaveBeenCalled()
  })
})

describe('when a send is started', () => {
  it('starts one for a working command, and the interactive app', async () => {
    const writeStats = vi.fn(async () => ({ file: 'x.html', submissions: 0, entries: 0, incomplete: 0, translateRuns: 0, translateEntries: 0, flagged: 0, weeks: [], topProjects: [] }))
    expect((await run(['stats', '--out', 'x.html'], { writeStats })).sendUsage).toHaveBeenCalledTimes(1)
    expect((await run([], { runTui: async () => undefined })).sendUsage).toHaveBeenCalledTimes(1)
  })

  it('never for usage-stats itself, config, or help', async () => {
    expect((await run(['usage-stats', 'show'])).sendUsage).not.toHaveBeenCalled()
    expect((await run(['config', 'get'])).sendUsage).not.toHaveBeenCalled()
    expect((await run(['--help'])).sendUsage).not.toHaveBeenCalled()
  })
})
