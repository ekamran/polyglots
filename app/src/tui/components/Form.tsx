import { useState } from 'react'
import { Box, Text } from 'ink'
import { Hint } from './Hint.js'
import { TextInput, useInput } from '../input.js'

export interface FormField {
  key: string
  label: string
  required?: boolean
  // A message when the value cannot be used, checked as it is typed.
  validate?: (value: string, all: Record<string, string>) => string | undefined
}

export interface FormProps {
  fields: FormField[]
  initial?: Record<string, string>
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
}

/**
 * A few text fields edited together. Tab or ↓ moves on, enter saves from any
 * field, esc cancels. A field's validation shows as it is typed, so a bad
 * regex is seen while writing it rather than when the save is refused.
 */
export function Form({ fields, initial = {}, onSubmit, onCancel }: FormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ''])),
  )
  const [focus, setFocus] = useState(0)
  const [error, setError] = useState<string>()

  const problems = fields
    .map((f) => {
      const v = values[f.key] ?? ''
      if (f.required && v.trim() === '') return `${f.label} is required`
      return f.validate?.(v, values)
    })
    .filter((p): p is string => p !== undefined)

  const submit = () => {
    if (problems.length > 0) {
      setError(problems[0])
      return
    }
    onSubmit(values)
  }

  useInput((_ch, key) => {
    if (key.escape) onCancel()
    else if (key.tab && key.shift) setFocus((f) => Math.max(0, f - 1))
    else if (key.tab || key.downArrow) setFocus((f) => Math.min(fields.length - 1, f + 1))
    else if (key.upArrow) setFocus((f) => Math.max(0, f - 1))
  })

  const width = Math.max(...fields.map((f) => f.label.length)) + 2
  return (
    <Box flexDirection="column">
      {fields.map((f, i) => {
        const live = f.validate?.(values[f.key] ?? '', values)
        return (
          <Box key={f.key} flexDirection="column">
            <Box>
              <Text>{i === focus ? '❯ ' : '  '}</Text>
              <Text>{`${f.label}:`.padEnd(width)}</Text>
              <TextInput
                value={values[f.key] ?? ''}
                focus={i === focus}
                onChange={(v) => {
                  setValues((prev) => ({ ...prev, [f.key]: v }))
                  setError(undefined)
                }}
                onSubmit={submit}
              />
            </Box>
            {live && (values[f.key] ?? '') !== '' && <Text color="yellow">{`    ${live}`}</Text>}
          </Box>
        )
      })}
      {error && <Text color="red">{error}</Text>}
      <Hint>tab next field · enter save · esc cancel</Hint>
    </Box>
  )
}
