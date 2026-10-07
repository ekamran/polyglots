import { Box, Text, useInput } from 'ink'

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
  useInput((ch, key) => {
    if (key.escape) onDone()
    else if (key.return) onChange(`${value}\n`)
    else if (key.backspace || key.delete) onChange(value.slice(0, -1))
    else if (ch && !key.ctrl && !key.meta) onChange(value + ch.replace(/\r\n?/g, '\n'))
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
