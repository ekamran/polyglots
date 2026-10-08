import { Box, Text } from 'ink'
import { useKeys } from '../hooks/useKeys.js'
import { useTypingWhile } from '../input.js'

export interface MultilineInputProps {
  value: string
  onChange: (value: string) => void
  onDone: () => void
}

/**
 * Free text over several lines: typing and pasting append, enter starts a new
 * line, backspace deletes, esc finishes. Deliberately append-only, the way the
 * fetch list is: editing in the middle of a paragraph is what an editor is
 * for, and `rules edit` opens one.
 */
export function MultilineInput({ value, onChange, onDone }: MultilineInputProps) {
  useTypingWhile(true)
  useKeys({
    back: { esc: onDone, q: undefined },
    multiline: {
      newline: () => onChange(`${value}\n`),
      erase: () => onChange(value.slice(0, -1)),
      type: (ch) => onChange(value + ch.replace(/\r\n?/g, '\n')),
    },
  })
  const lines = value.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>
          {'  '}
          {line}
          {i === lines.length - 1 && <Text inverse> </Text>}
        </Text>
      ))}
    </Box>
  )
}
