import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import React from 'react'
import { cleanup } from 'ink-testing-library'
import { profileFor } from '../../src/audit/rules/profiles.js'
import { localeRulesFile, loadLocaleRules } from '../../src/rules/load.js'
import { App } from '../../src/tui/App.js'
import { CommandsProvider } from '../../src/tui/commands.js'
import { LocaleRules } from '../../src/tui/screens/LocaleRules.js'
import { ESC_DELAY, fakeCommands, flat, hopsTo, keys, makeHome, render, tick, waitFor, waitForText, type Home } from './helpers.js'

let home: Home

beforeEach(async () => {
  home = await makeHome()
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

function mount(onBack: () => void = () => undefined) {
  return render(
    <CommandsProvider value={fakeCommands()}>
      <LocaleRules onBack={onBack} />
    </CommandsProvider>,
  )
}

type View = ReturnType<typeof mount>

async function openLocale(view: View) {
  await waitForText(view.lastFrame, /Locale/)
  view.stdin.write(keys.enter)
  await waitForText(view.lastFrame, /Built-in rules/)
}

async function select(view: View, label: RegExp) {
  for (let i = 0; i < 10 && !new RegExp(`❯ ${label.source}`).test(view.lastFrame()); i++) {
    view.stdin.write(keys.down)
    await tick()
  }
  view.stdin.write(keys.enter)
  await tick()
}

describe('LocaleRules: picking a locale', () => {
  it('opens the configured locale and names its file', async () => {
    const view = mount()
    await openLocale(view)
    expect(flat(view.lastFrame())).toMatch(/tr_TR \(tr\)/)
    expect(flat(view.lastFrame())).toMatch(/built-in defaults/)
  })

  it('accepts any spelling of a locale', async () => {
    const view = mount()
    await waitForText(view.lastFrame, /Locale/)
    view.stdin.write(keys.backspace)
    await tick()
    view.stdin.write(keys.backspace)
    await tick()
    view.stdin.write('nl_NL_formal')
    await tick()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /nl_NL_formal \(nl\/formal\)/)
  })

  it('refuses a locale wp.org does not list, and stays on the field', async () => {
    const view = mount()
    await waitForText(view.lastFrame, /Locale/)
    view.stdin.write(keys.backspace)
    await tick()
    view.stdin.write(keys.backspace)
    await tick()
    view.stdin.write('zz')
    await tick()
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /not listed on translate\.wordpress\.org/)
  })

  it('reports a rules file it cannot read instead of editing a guess', async () => {
    const file = localeRulesFile('tr')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'rules:\n  enable: [nope]\n', 'utf8')
    const view = mount()
    await waitForText(view.lastFrame, /Locale/)
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /nope/)
  })
})

describe('LocaleRules: built-in rules', () => {
  it('shows every built-in rule with its state and toggles one', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Built-in rules/)
    await waitForText(view.lastFrame, /title-case/)
    expect(view.lastFrame()).toMatch(/\[x\] title-case/)
    expect(view.lastFrame()).toMatch(/placeholder.*universal/)
    await select(view, /\[x\] title-case/)
    await waitForText(view.lastFrame, /\[ \] title-case/)
  })

  it('saves the toggle so the rule stops running for the locale', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Built-in rules/)
    await select(view, /\[x\] title-case/)
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    await waitForText(view.lastFrame, /unsaved/)
    view.stdin.write('s')
    await waitForText(view.lastFrame, /Saved/)
    expect(profileFor('tr').rules.has('title-case')).toBe(false)
    expect(profileFor('tr').rules.has('apostrophe')).toBe(true)
  })
})

describe('LocaleRules: glossary match', () => {
  it('steps the ratio and saves it', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Glossary match/)
    await waitForText(view.lastFrame, /0\.70/)
    view.stdin.write(keys.right)
    await tick()
    view.stdin.write(keys.right)
    await waitForText(view.lastFrame, /0\.80/)
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write('s')
    await waitForText(view.lastFrame, /Saved/)
    expect(loadLocaleRules('tr')?.glossaryStemRatio).toBe(0.8)
  })
})

async function typeInto(view: View, text: string) {
  view.stdin.write(text)
  await tick()
}

describe('LocaleRules: common mistakes', () => {
  it('adds a mistake with its right form and note, and saves it', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Common mistakes/)
    await waitForText(view.lastFrame, /No mistakes yet/)
    view.stdin.write('a')
    await waitForText(view.lastFrame, /Wrong:/)
    await typeInto(view, 'önizleme')
    view.stdin.write(keys.tab)
    await tick()
    await typeInto(view, 'ön izleme')
    view.stdin.write(keys.tab)
    await tick()
    await typeInto(view, 'TDK writes it as two words')
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /önizleme → ön izleme/)
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write('s')
    await waitForText(view.lastFrame, /Saved/)
    const p = loadLocaleRules('tr')!.patterns[0]!
    expect(p).toMatchObject({ kind: 'mistake', text: 'önizleme', right: 'ön izleme', note: 'TDK writes it as two words' })
  })

  it('will not add a mistake with nothing to look for', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Common mistakes/)
    view.stdin.write('a')
    await waitForText(view.lastFrame, /Wrong:/)
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Wrong is required/)
  })

  it('edits and deletes a mistake', async () => {
    const file = localeRulesFile('tr')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'mistakes:\n  - wrong: önizleme\n  - wrong: eposta\n', 'utf8')
    const view = mount()
    await openLocale(view)
    await select(view, /Common mistakes/)
    await waitForText(view.lastFrame, /eposta/)
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Wrong:/)
    view.stdin.write(keys.tab)
    await tick()
    await typeInto(view, 'e-posta')
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /önizleme → e-posta/)
    view.stdin.write(keys.down)
    await tick()
    view.stdin.write('d')
    await waitFor(() => !/eposta/.test(view.lastFrame()))
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write('s')
    await waitForText(view.lastFrame, /Saved/)
    expect(loadLocaleRules('tr')!.patterns.map((p) => [p.text, p.right])).toEqual([['önizleme', 'e-posta']])
  })
})

describe('LocaleRules: proper nouns', () => {
  it('starts from the built-in list and adds a name to it', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Proper nouns/)
    await waitForText(view.lastFrame, /Always capitalized/)
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Türkiye/)
    view.stdin.write('a')
    await waitForText(view.lastFrame, /Name:/)
    await typeInto(view, 'Anadolu')
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Anadolu/)
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write('s')
    await waitForText(view.lastFrame, /Saved/)
    const always = loadLocaleRules('tr')!.properNouns!.always!
    expect(always).toContain('Türkiye')
    expect(always).toContain('Anadolu')
    // The other list was not touched, so it stays built-in.
    expect(loadLocaleRules('tr')!.properNouns!.dateOnly).toBeUndefined()
  })
})

describe('LocaleRules: leaving', () => {
  it('asks before discarding unsaved changes, and discards on d', async () => {
    let back = 0
    const view = mount(() => back++)
    await openLocale(view)
    await select(view, /Glossary match/)
    view.stdin.write(keys.right)
    await tick()
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    view.stdin.write(keys.esc)
    await waitForText(view.lastFrame, /Unsaved changes/)
    expect(back).toBe(0)
    view.stdin.write('d')
    await waitFor(() => back === 1)
    expect(loadLocaleRules('tr')).toBeUndefined()
  })

  it('leaves at once when nothing changed', async () => {
    let back = 0
    const view = mount(() => back++)
    await openLocale(view)
    view.stdin.write(keys.esc)
    await waitFor(() => back === 1)
  })

  // Saving re-reviews the locale's files; the person should know before.
  it('says what saving costs', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Glossary match/)
    view.stdin.write(keys.right)
    await tick()
    view.stdin.write(keys.esc)
    await waitForText(view.lastFrame, /next review of every tr file starts over/)
  })

  it('shows why a save failed, and keeps the edits', async () => {
    const view = mount()
    await openLocale(view)
    await select(view, /Glossary match/)
    view.stdin.write(keys.right)
    await tick()
    view.stdin.write(keys.esc)
    await tick(ESC_DELAY)
    // Someone edits the file in another window meanwhile.
    const file = localeRulesFile('tr')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'guidance: Elsewhere.\n', 'utf8')
    view.stdin.write('s')
    await waitForText(view.lastFrame, /changed on disk/)
    expect(await readFile(file, 'utf8')).toBe('guidance: Elsewhere.\n')
    expect(view.lastFrame()).toMatch(/unsaved/)
  })
})

describe('Menu entry', () => {
  it('reaches the locale rules screen', async () => {
    const view = render(<App commands={fakeCommands()} />)
    await tick()
    for (let i = 0; i < hopsTo('locale-rules'); i++) {
      view.stdin.write(keys.down)
      await tick()
    }
    view.stdin.write(keys.enter)
    await waitForText(view.lastFrame, /Locale rules/)
  })
})
