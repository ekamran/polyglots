import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { FilePicker } from '../../src/tui/components/FilePicker.js'
import { keys, render, tick, waitForText } from './helpers.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'polyglots-picker-'))
  await mkdir(join(root, 'languages'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'readme.txt'), '')
  await writeFile(join(root, 'plugin-tr.po'), '')
  await writeFile(join(root, '.hidden.po'), '')
  await writeFile(join(root, 'languages', 'theme-tr.po'), '')
  await writeFile(join(root, 'languages', 'theme.pot'), '')
  await writeFile(join(root, 'languages', 'memory.tmx'), '')
})

afterEach(async () => {
  cleanup()
  await rm(root, { recursive: true, force: true })
})

describe('FilePicker', () => {
  it('shows the current path, parent, directories and only matching files', async () => {
    const { lastFrame } = render(<FilePicker dir={root} extensions={['.po']} onPick={() => undefined} />)
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toContain(root)
    expect(frame).toContain('..')
    expect(frame).toContain('languages/')
    expect(frame).toContain('src/')
    expect(frame).toContain('plugin-tr.po')
    expect(frame).not.toContain('readme.txt')
    expect(frame).not.toContain('.hidden.po')
  })

  // With many folders in a directory, listing them first buries the .po files the
  // picker exists to find, so matching files come first and .. stays pinned on top.
  it('lists matching files above directories, with .. first', async () => {
    await writeFile(join(root, 'another-tr.po'), '')
    const { lastFrame } = render(<FilePicker dir={root} extensions={['.po']} onPick={() => undefined} />)
    await tick()
    const lines = (lastFrame() ?? '').split('\n').map((l) => l.replace(/[^\x20-\x7E]/g, '').trim())

    const at = (needle: string) => lines.findIndex((l) => l.includes(needle))
    expect(at('..')).toBeGreaterThanOrEqual(0)
    expect(at('another-tr.po')).toBeGreaterThan(at('..'))
    expect(at('plugin-tr.po')).toBeGreaterThan(at('another-tr.po'))
    expect(at('languages/')).toBeGreaterThan(at('plugin-tr.po'))
    expect(at('src/')).toBeGreaterThan(at('languages/'))
  })

  it('enters a subdirectory and picks a file with enter', async () => {
    const picked: string[] = []
    const { lastFrame, stdin } = render(<FilePicker dir={root} extensions={['.po']} onPick={(p) => picked.push(p)} />)
    await tick()
    // Order at root is .. / plugin-tr.po / languages/ / src/, so the first
    // directory now sits below the matching files.
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)
    await waitForText(lastFrame, join(root, 'languages'))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('theme-tr.po')
    expect(frame).not.toContain('theme.pot')
    expect(frame).not.toContain('memory.tmx')

    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)
    await tick()
    expect(picked).toEqual([join(root, 'languages', 'theme-tr.po')])
  })

  it('goes back up with the .. entry', async () => {
    const { lastFrame, stdin } = render(<FilePicker dir={join(root, 'languages')} extensions={['.tmx']} onPick={() => undefined} />)
    await tick()
    expect(lastFrame()).toContain('memory.tmx')
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'src/')
    expect(lastFrame()).not.toContain('memory.tmx')
  })

  it('lists .tmx files when asked', async () => {
    const { lastFrame } = render(<FilePicker dir={join(root, 'languages')} extensions={['.tmx']} onPick={() => undefined} />)
    await tick()
    expect(lastFrame()).toContain('memory.tmx')
    expect(lastFrame()).not.toContain('theme-tr.po')
  })
})
