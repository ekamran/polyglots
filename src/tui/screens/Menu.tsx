import { createRequire } from 'node:module'
import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import { usableProviders, type AgentStatus } from '../../agent/discover.js'
import { PROVIDERS } from '../../agent/providers.js'
import type { ReviewProvider } from '../../types.js'
import { Hint } from '../components/Hint.js'

// Read the same way the CLI reads it, so the two can never disagree about
// which build is running.
const { version: VERSION } = createRequire(import.meta.url)('../../../package.json') as { version: string }

export type MenuAction =
  | 'translate'
  | 'review'
  | 'fetch'
  | 'split'
  | 'stats'
  | 'import-tm'
  | 'export-tm'
  | 'sync-glossary'
  | 'locale-rules'
  | 'agents'
  | 'configure-keys'

export const MENU_ITEMS: { label: string; value: MenuAction }[] = [
  { label: 'Translate a .po file', value: 'translate' },
  { label: 'Review a submitted .po', value: 'review' },
  { label: 'Fetch from translate.wordpress.org', value: 'fetch' },
  { label: 'Split a .po into parts', value: 'split' },
  { label: 'Review statistics', value: 'stats' },
  { label: 'Import Translation Memory (.tmx or .po)', value: 'import-tm' },
  { label: 'Export Translation Memory', value: 'export-tm' },
  { label: 'Sync WordPress.org glossary', value: 'sync-glossary' },
  { label: 'Locale rules', value: 'locale-rules' },
  { label: 'Check AI agents', value: 'agents' },
  { label: 'Configure API keys', value: 'configure-keys' },
]

/**
 * The provider `p` moves to. Wraps, so one key reaches every candidate
 * however many there are.
 *
 * With `usable` undefined, because discovery has not finished or could not
 * run, every provider is a candidate, so the menu never waits on a spawn.
 * Otherwise the candidates are the usable ones plus the current one, in
 * PROVIDERS order, and the result is `current` itself when nothing else
 * qualifies.
 */
export function nextProvider(current: ReviewProvider, usable?: readonly ReviewProvider[]): ReviewProvider {
  const pool = usable === undefined ? PROVIDERS : PROVIDERS.filter((p) => p === current || usable.includes(p))
  const at = pool.indexOf(current)
  return pool[(at + 1) % pool.length]!
}

export interface MenuProps {
  onSelect: (action: MenuAction) => void
  onQuit: () => void
  provider: ReviewProvider
  // Persisted by the caller rather than here, so this screen stays something
  // that can be rendered without writing to the user's config.
  onProvider: (next: ReviewProvider) => void
  // Shown when the choice could not be saved. The displayed provider does not
  // move in that case: a run reads the saved config, so showing the new one
  // would name an agent no review is going to use.
  providerError?: string
  // Undefined until discovery has an answer, and for good if it failed.
  agents?: AgentStatus[]
  checking?: boolean
  // The provider the config named at launch. Always kept in the rotation, so
  // that `p` can return to it after a switch away even when it is unusable:
  // the choice was the person's, and the menu does not get to erase it.
  configured?: ReviewProvider
}

export function Menu({ onSelect, onQuit, provider, onProvider, providerError, agents, checking, configured }: MenuProps) {
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const usable = agents === undefined ? undefined : [...usableProviders(agents), ...(configured ? [configured] : [])]
  const unusable = (agents ?? []).filter((a) => !a.usable)
  const current = agents?.find((a) => a.provider === provider)
  const others = unusable.filter((a) => a.provider !== provider)
  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) onQuit()
    if (input === 'p') {
      const next = nextProvider(provider, usable)
      if (next === provider) {
        const why = others.map((a) => `${a.provider}: ${a.reason ?? 'unavailable'}`).join('; ')
        setNotice(`No other usable agent${why ? `: ${why}` : ''}`)
        return
      }
      setNotice(undefined)
      onProvider(next)
    }
  })
  return (
    <Box flexDirection="column">
      <Text bold>
        polyglots <Text dimColor>v{VERSION}</Text>
      </Text>
      <Text dimColor>
        Provider: {provider} · p to switch
      </Text>
      {current && !current.usable && <Text color="yellow">{current.reason ?? 'unavailable'}</Text>}
      {others.length > 0 && (
        <Text dimColor>Unavailable: {others.map((a) => `${a.provider} (${a.reason ?? 'unavailable'})`).join(', ')}</Text>
      )}
      {checking && <Text dimColor>Checking agents…</Text>}
      {notice && <Text color="yellow">{notice}</Text>}
      {providerError && <Text color="yellow">Could not save that: {providerError}</Text>}
      <SelectInput items={MENU_ITEMS} onSelect={(item) => onSelect(item.value)} />
      <Hint>↑↓ move · enter select · p provider · q quit</Hint>
    </Box>
  )
}
