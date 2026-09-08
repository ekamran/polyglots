import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'
import { Hint } from '../components/Hint.js'

export type MenuAction = 'translate' | 'import-tm' | 'sync-glossary' | 'configure-keys'

export const MENU_ITEMS: { label: string; value: MenuAction }[] = [
  { label: 'Translate a .po file', value: 'translate' },
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
      <Text bold>polyglots</Text>
      <SelectInput items={MENU_ITEMS} onSelect={(item) => onSelect(item.value)} />
      <Hint>↑↓ move · enter select · q quit</Hint>
    </Box>
  )
}
