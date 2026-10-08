import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { saveConfig } from '../../src/config.js'
import { CommandsProvider } from '../../src/tui/commands.js'
import { SyncGlossary } from '../../src/tui/screens/SyncGlossary.js'
import { fakeCommands, keys, makeHome, tick, waitForText, render, cleanup, type Home } from './helpers.js'

let home: Home

beforeEach(async () => {
  home = await makeHome()
  // Named rather than assumed: polyglots has no default locale (no-locale.test.tsx).
  saveConfig({ defaultLocale: 'tr' })
})

afterEach(async () => {
  cleanup()
  await home.cleanup()
})

function mount(commands = fakeCommands(), onBack: () => void = () => undefined) {
  return render(
    <CommandsProvider value={commands}>
      <SyncGlossary onBack={onBack} />
    </CommandsProvider>,
  )
}

describe('SyncGlossary', () => {
  it('prefills the configured locale, lets the user edit it and reports the count', async () => {
    saveConfig({ defaultLocale: 'de' })
    const commands = fakeCommands()
    let back = 0
    const { lastFrame, stdin } = mount(commands, () => back++)
    await waitForText(lastFrame, /Locale/)
    expect(lastFrame()).toContain('de')

    stdin.write('-at')
    await waitForText(lastFrame, 'de-at')
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'Synced 42 glossary entries for de-at.')
    expect(vi.mocked(commands.syncGlossary).mock.calls[0]![0]).toMatchObject({ locale: 'de-at' })

    stdin.write(keys.enter)
    await tick()
    expect(back).toBe(1)
  })

  it('normalizes the locale before syncing', async () => {
    saveConfig({ defaultLocale: 'tr' })
    const commands = fakeCommands()
    const { lastFrame, stdin } = mount(commands)
    await waitForText(lastFrame, /Locale/)
    stdin.write('_TR ')
    await waitForText(lastFrame, 'tr_TR')
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'Synced 42 glossary entries for tr.')
    expect(vi.mocked(commands.syncGlossary).mock.calls[0]![0]).toMatchObject({ locale: 'tr' })
  })

  it('shows a failure and lets the user fix the locale and retry without leaving the screen', async () => {
    let back = 0
    const syncGlossary = vi.fn(async ({ locale }: { locale: string }) => {
      if (locale !== 'de') throw new Error(`No glossary entries found for locale "${locale}"; existing cache left untouched`)
      return { entries: 7 }
    })
    const commands = fakeCommands({ syncGlossary })
    const { lastFrame, stdin } = mount(commands, () => back++)
    await waitForText(lastFrame, /Locale/)
    stdin.write('x')
    await waitForText(lastFrame, 'trx')
    stdin.write(keys.enter)
    await waitForText(lastFrame, /No glossary entries found for locale "trx"/)
    expect(back).toBe(0)

    stdin.write(keys.enter)
    await waitForText(lastFrame, 'enter to sync')
    expect(back).toBe(0)
    for (let i = 0; i < 3; i++) {
      stdin.write(keys.backspace)
      await tick()
    }
    stdin.write('de')
    await waitForText(lastFrame, /Locale:\s+de\s*$/m)
    stdin.write(keys.enter)
    await waitForText(lastFrame, 'Synced 7 glossary entries for de.')
    expect(syncGlossary).toHaveBeenCalledTimes(2)
  })
})
