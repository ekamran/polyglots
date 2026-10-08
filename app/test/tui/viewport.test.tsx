import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { App } from '../../src/tui/App.js'
import { cleanup, fakeCommands, flat, keys, makeHome, openFromHome, render, tick, waitForText, type Home } from './helpers.js'

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

// The built-in rules list, its detail and its hint come to 25 body rows,
// which a 24-row terminal cannot hold under the wordmark and over the footer.
async function openRuleList(size = { columns: 80, rows: 24 }) {
  const view = render(<App commands={fakeCommands()} cwd={cwd} />, size)
  await openFromHome(view.stdin, 'locale-rules')
  await waitForText(view.lastFrame, 'Locale: tr')
  view.stdin.write(keys.enter)
  await waitForText(view.lastFrame, 'Built-in rules')
  view.stdin.write(keys.enter)
  await waitForText(view.lastFrame, 'placeholder')
  return view
}

const lines = (frame: string) => frame.split('\n')

describe('a screen taller than the body', () => {
  it('keeps the frame inside the terminal, footer included', async () => {
    const { lastFrame } = await openRuleList()
    const frame = lastFrame()
    expect(lines(frame).length).toBeLessThanOrEqual(24)
    expect(flat(frame)).toContain('? help')
  })

  it('says how much is out of sight below', async () => {
    const { lastFrame } = await openRuleList()
    expect(flat(lastFrame())).toMatch(/↓ \d+ more/)
  })

  it('scrolls to keep the row in focus visible, and back', async () => {
    const { lastFrame, stdin } = await openRuleList()
    for (let i = 0; i < 15; i++) {
      stdin.write(keys.down)
      await tick()
    }
    await waitForText(lastFrame, /❯ \[x\] control/)
    expect(lines(lastFrame()).length).toBeLessThanOrEqual(24)
    expect(flat(lastFrame())).toMatch(/↑ \d+ more/)
    expect(flat(lastFrame())).toContain('? help')
    for (let i = 0; i < 15; i++) {
      stdin.write(keys.up)
      await tick()
    }
    await waitForText(lastFrame, /❯ \[x\] placeholder/)
    expect(flat(lastFrame())).toContain('Locale rules')
  })

  it('draws a screen that fits exactly as before, with no marker', async () => {
    const { lastFrame } = await openRuleList({ columns: 80, rows: 40 })
    expect(lastFrame()).not.toMatch(/[↑↓] \d+ more/)
    expect(lastFrame()).toContain('Locale rules')
  })

  it('starts the next screen at its top', async () => {
    const { lastFrame, stdin } = await openRuleList()
    for (let i = 0; i < 15; i++) {
      stdin.write(keys.down)
      await tick()
    }
    await waitForText(lastFrame, /❯ \[x\] control/)
    stdin.write(keys.esc)
    await tick(60)
    await waitForText(lastFrame, 'Built-in rules')
    expect(flat(lastFrame())).toContain('Locale rules ·')
    expect(lastFrame()).not.toMatch(/↑ \d+ more/)
  })

  // Under an overlay or the too-small notice the body lays out at no height;
  // the offset must survive that, or the row in focus comes back out of view.
  it('keeps the row in focus in view across the help overlay and a resize below the minimum', async () => {
    const view = await openRuleList()
    for (let i = 0; i < 15; i++) {
      view.stdin.write(keys.down)
      await tick()
    }
    await waitForText(view.lastFrame, /❯ \[x\] control/)
    view.stdin.write('?')
    await tick(20)
    view.stdin.write(keys.esc)
    await tick(60)
    await waitForText(view.lastFrame, /❯ \[x\] control/)
    view.resize(59, 20)
    await waitForText(view.lastFrame, 'Enlarge the terminal')
    view.resize(80, 24)
    await waitForText(view.lastFrame, /❯ \[x\] control/)
    expect(lines(view.lastFrame()).length).toBeLessThanOrEqual(24)
  })
})
