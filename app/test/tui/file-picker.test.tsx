import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'
import { FilePicker, itemColor, nextSort, SORT_LABEL } from '../../src/tui/components/FilePicker.js'
import { poEntryCount } from '../../src/po/count.js'
import { keys, render, tick, waitForText, cleanup } from './helpers.js'

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

describe('itemColor', () => {
  it('paints matching files yellow so they stand out among folders', () => {
    expect(itemColor('file', false)).toBe('yellow')
  })

  // Selection wins over the file colour. Yellow-on-yellow left the cursor row
  // and its neighbours separated only by weight, which is not a difference you
  // can see at a glance in a list of near-identical file names.
  it('paints the selected row the same blue as the pointer, whatever its kind', () => {
    expect(itemColor('file', true)).toBe('blue')
    expect(itemColor('dir', true)).toBe('blue')
  })

  it('leaves directories uncoloured until selected', () => {
    expect(itemColor('dir', false)).toBeUndefined()
  })
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

// Files are written with distinct mtimes so date ordering is deterministic. The
// picker breaks a tie on name, but a test that relied on the tiebreak would not
// be testing the date sort at all.
async function withMtime(path: string, body: string, at: number): Promise<void> {
  await writeFile(path, body)
  await utimes(path, new Date(at), new Date(at))
}

const catalogue = (n: number): string =>
  ['msgid ""', 'msgstr ""', ''].concat(Array.from({ length: n }, (_, i) => `msgid "s${i}"\nmsgstr ""\n`)).join('\n')

const visible = (frame: string | undefined): string[] =>
  (frame ?? '').split('\n').map((l) => l.replace(/[^\x20-\x7E]/g, '').trim())

describe('nextSort', () => {
  // The cycle the s key walks, starting from the default.
  it('walks newest, A-Z, Z-A, oldest and back', () => {
    expect(nextSort('date-desc')).toBe('name-asc')
    expect(nextSort('name-asc')).toBe('name-desc')
    expect(nextSort('name-desc')).toBe('date-asc')
    expect(nextSort('date-asc')).toBe('date-desc')
  })
})

describe('FilePicker entry counts', () => {
  it('shows how many entries each catalogue holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'polyglots-counts-'))
    try {
      await writeFile(join(dir, 'small-tr.po'), catalogue(222))
      await writeFile(join(dir, 'big-tr.po'), catalogue(9826))
      const { lastFrame } = render(
        <FilePicker dir={dir} extensions={['.po']} onPick={() => undefined} annotate={poEntryCount} />,
      )
      await tick()
      const frame = lastFrame() ?? ''
      expect(frame).toMatch(/small-tr\.po\s+222/)
      expect(frame).toMatch(/big-tr\.po\s+9826/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves non-catalogue files unannotated', async () => {
    const { lastFrame } = render(
      <FilePicker dir={join(root, 'languages')} extensions={['.tmx']} onPick={() => undefined} annotate={poEntryCount} />,
    )
    await tick()
    expect(visible(lastFrame()).some((l) => /^memory\.tmx$/.test(l))).toBe(true)
  })
})

describe('FilePicker sorting', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'polyglots-sort-'))
    // Name order and date order disagree on purpose: alpha.po is the oldest and
    // zulu.po the newest, so a wrong sort cannot pass by coincidence.
    await withMtime(join(dir, 'alpha.po'), catalogue(1), Date.now() - 300_000)
    await withMtime(join(dir, 'mike.po'), catalogue(2), Date.now() - 200_000)
    await withMtime(join(dir, 'zulu.po'), catalogue(3), Date.now() - 100_000)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const order = (frame: string | undefined): string[] =>
    visible(frame)
      .map((l) => l.match(/^(alpha|mike|zulu)\.po/)?.[0])
      .filter((n): n is string => n !== undefined)

  // The file a session is about is nearly always the one just downloaded, and a
  // name sort buries it wherever the alphabet puts it.
  it('defaults to newest first', async () => {
    const { lastFrame } = render(<FilePicker dir={dir} extensions={['.po']} onPick={() => undefined} />)
    await tick()
    expect(order(lastFrame())).toEqual(['zulu.po', 'mike.po', 'alpha.po'])
  })

  it('names the current sort so the order on screen is never a guess', async () => {
    const { lastFrame } = render(<FilePicker dir={dir} extensions={['.po']} onPick={() => undefined} />)
    await tick()
    expect(lastFrame()).toContain(SORT_LABEL['date-desc'])
  })

  it('cycles through all four orders with s and returns to the default', async () => {
    const { lastFrame, stdin } = render(<FilePicker dir={dir} extensions={['.po']} onPick={() => undefined} />)
    await tick()

    stdin.write('s')
    await tick()
    expect(order(lastFrame())).toEqual(['alpha.po', 'mike.po', 'zulu.po'])
    expect(lastFrame()).toContain(SORT_LABEL['name-asc'])

    stdin.write('s')
    await tick()
    expect(order(lastFrame())).toEqual(['zulu.po', 'mike.po', 'alpha.po'])
    expect(lastFrame()).toContain(SORT_LABEL['name-desc'])

    stdin.write('s')
    await tick()
    expect(order(lastFrame())).toEqual(['alpha.po', 'mike.po', 'zulu.po'])
    expect(lastFrame()).toContain(SORT_LABEL['date-asc'])

    stdin.write('s')
    await tick()
    expect(order(lastFrame())).toEqual(['zulu.po', 'mike.po', 'alpha.po'])
    expect(lastFrame()).toContain(SORT_LABEL['date-desc'])
  })

  // Sorting must not become a way to pick the wrong file: whatever the order,
  // enter opens what the cursor is actually on. Re-sorting parks the cursor back
  // on .., since every row below it has moved, so the first file is one step down.
  it('picks the file the cursor is on after a re-sort', async () => {
    const picked: string[] = []
    const { stdin } = render(<FilePicker dir={dir} extensions={['.po']} onPick={(p) => picked.push(p)} />)
    await tick()
    stdin.write('s')
    await tick()
    stdin.write(keys.down)
    await tick()
    stdin.write(keys.enter)
    await tick()
    expect(picked).toEqual([join(dir, 'alpha.po')])
  })
})

describe('FilePicker choosing a folder', () => {
  it('lists folders only, with a row that picks the one being browsed', async () => {
    const { lastFrame } = render(
      <FilePicker dir={root} extensions={['.po']} chooseDir onPick={() => undefined} />,
    )
    await tick()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('[ use this folder ]')
    expect(frame).toContain('languages/')
    // A file is not a choice here, and leaving it in only lengthens the list.
    expect(frame).not.toContain('plugin-tr.po')
  })

  // Opening the picker and pressing enter should choose where you already are,
  // which is the answer often enough to be worth the top row.
  it('picks the current folder on the first enter', async () => {
    const picked: string[] = []
    const { stdin } = render(
      <FilePicker dir={root} extensions={['.po']} chooseDir onPick={(p) => picked.push(p)} />,
    )
    await tick()
    stdin.write(keys.enter)
    await tick()
    expect(picked).toEqual([root])
  })

  it('walks into a subfolder and picks that instead', async () => {
    const picked: string[] = []
    const { lastFrame, stdin } = render(
      <FilePicker dir={root} extensions={['.po']} chooseDir onPick={(p) => picked.push(p)} />,
    )
    await tick()
    // Rows are: [ use this folder ], .., languages/, src/
    for (let i = 0; i < 2; i++) {
      stdin.write(keys.down)
      await tick()
    }
    stdin.write(keys.enter)
    await waitForText(lastFrame, join(root, 'languages'))
    stdin.write(keys.enter)
    await tick()
    expect(picked).toEqual([join(root, 'languages')])
  })

  it('says nothing about missing files when files are not the point', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'polyglots-nodirs-'))
    try {
      const { lastFrame } = render(
        <FilePicker dir={empty} extensions={['.po']} chooseDir onPick={() => undefined} />,
      )
      await tick()
      expect(lastFrame() ?? '').not.toContain('no .po files here')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
