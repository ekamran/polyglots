import { Box, Text } from 'ink'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useKeys } from '../hooks/useKeys.js'
import { Hint } from './Hint.js'

export interface NeedsLocaleProps {
  title: string
  // What the screen would have done, said so the person knows why they are stopped.
  needs: string
  onBack: () => void
  // Absent where the screen is shown outside the menu's frame, which has no
  // wizard to open; the hint then says only how to leave.
  onSetup?: () => void
}

/**
 * Stands in for a screen that cannot do anything without a locale when none
 * is configured. These screens used to run in tr without saying so, which is
 * how a fetch could download another locale's strings, or an import file
 * someone's memory under the wrong language, for a person who never chose
 * one. Typing a locale on these screens was never offered, and adding it to
 * each is more surface than one trip through setup.
 */
export function NeedsLocale({ title, needs, onBack, onSetup }: NeedsLocaleProps) {
  useBackKeys(onBack)
  useKeys({ needsLocale: { setup: onSetup } })
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text>No locale set yet. {needs} needs one: the locale you translate into, as translate.wordpress.org names it.</Text>
      <Text dimColor>Setup chooses it, or: {'polyglots config set defaultLocale <code>'}</Text>
      <Hint>{onSetup ? 'enter to open setup · esc back to menu' : 'esc back to menu'}</Hint>
    </Box>
  )
}
