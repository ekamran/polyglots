import { createRequire } from 'node:module'
import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import { PROVIDERS } from '../../agent/providers.js'
import type { ReviewProvider } from '../../types.js'
import { Hint } from '../components/Hint.js'

// Read the same way the CLI reads it, so the two can never disagree about
// which build is running.
const { version: VERSION } = createRequire(import.meta.url)('../../../package.json') as { version: string }

export type MenuAction =
  | 'translate'
  | 'review'
  | 'split'
  | 'stats'
  | 'import-tm'
  | 'sync-glossary'
  | 'configure-keys'

export const MENU_ITEMS: { label: string; value: MenuAction }[] = [
  { label: 'Translate a .po file', value: 'translate' },
  { label: 'Review a submitted .po', value: 'review' },
  { label: 'Split a .po into parts', value: 'split' },
  { label: 'Review statistics', value: 'stats' },
  { label: 'Import Translation Memory (.tmx)', value: 'import-tm' },
  { label: 'Sync WordPress.org glossary', value: 'sync-glossary' },
  { label: 'Configure API keys', value: 'configure-keys' },
]

// Wraps, so one key reaches every provider however many there are.
export function nextProvider(current: ReviewProvider): ReviewProvider {
  const at = PROVIDERS.indexOf(current)
  return PROVIDERS[(at + 1) % PROVIDERS.length]!
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
}

export function Menu({ onSelect, onQuit, provider, onProvider, providerError }: MenuProps) {
  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) onQuit()
    if (input === 'p') onProvider(nextProvider(provider))
  })
  return (
    <Box flexDirection="column">
      <Text bold>
        polyglots <Text dimColor>v{VERSION}</Text>
      </Text>
      <Text dimColor>
        Reviewing with {provider} · p to switch
      </Text>
      {providerError && <Text color="yellow">Could not save that: {providerError}</Text>}
      <SelectInput items={MENU_ITEMS} onSelect={(item) => onSelect(item.value)} />
      <Hint>↑↓ move · enter select · p provider · q quit</Hint>
    </Box>
  )
}
