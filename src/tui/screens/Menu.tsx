import { createRequire } from 'node:module'
import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import { Hint } from '../components/Hint.js'

// Read the same way the CLI reads it, so the two can never disagree about
// which build is running.
const { version: VERSION } = createRequire(import.meta.url)('../../../package.json') as { version: string }

export type MenuAction = 'translate' | 'review' | 'stats' | 'import-tm' | 'sync-glossary' | 'configure-keys'

export const MENU_ITEMS: { label: string; value: MenuAction }[] = [
  { label: 'Translate a .po file', value: 'translate' },
  { label: 'Review a submitted .po', value: 'review' },
  { label: 'Review statistics', value: 'stats' },
  { label: 'Import Translation Memory (.tmx)', value: 'import-tm' },
  { label: 'Sync WordPress.org glossary', value: 'sync-glossary' },
  { label: 'Configure API keys', value: 'configure-keys' },
]

export interface MenuProps {
  onSelect: (action: MenuAction) => void
  onQuit: () => void
}

export function Menu({ onSelect, onQuit }: MenuProps) {
  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) onQuit()
  })
  return (
    <Box flexDirection="column">
      <Text bold>
        polyglots <Text dimColor>v{VERSION}</Text>
      </Text>
      <SelectInput items={MENU_ITEMS} onSelect={(item) => onSelect(item.value)} />
      <Hint>↑↓ move · enter select · q quit</Hint>
    </Box>
  )
}
