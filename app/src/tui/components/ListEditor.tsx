import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { Form, type FormField } from './Form.js'
import { Hint } from './Hint.js'

export interface ListEditorProps<T> {
  title: string
  items: T[]
  empty: string
  describe: (item: T) => string
  fields: FormField[]
  toForm: (item: T) => Record<string, string>
  fromForm: (values: Record<string, string>) => T
  onChange: (items: T[]) => void
  onBack: () => void
  // Rows shown at once; the window follows the cursor through a long list.
  window?: number
}

/**
 * A list edited in place: a adds, enter edits, d deletes, esc goes back.
 * Changes go straight to `onChange`; saving them is the caller's business.
 */
export function ListEditor<T>({
  title,
  items,
  empty,
  describe,
  fields,
  toForm,
  fromForm,
  onChange,
  onBack,
  window = 12,
}: ListEditorProps<T>) {
  const [cursor, setCursor] = useState(0)
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'add' } | { kind: 'edit'; index: number }>({ kind: 'list' })

  useInput(
    (ch, key) => {
      if (key.escape) onBack()
      else if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1))
      else if (ch === 'a') setMode({ kind: 'add' })
      else if (key.return && items.length > 0) setMode({ kind: 'edit', index: cursor })
      else if (ch === 'd' && items.length > 0) {
        onChange(items.filter((_, i) => i !== cursor))
        setCursor((c) => Math.max(0, Math.min(c, items.length - 2)))
      }
    },
    { isActive: mode.kind === 'list' },
  )

  if (mode.kind !== 'list') {
    const editing = mode.kind === 'edit' ? items[mode.index] : undefined
    return (
      <Box flexDirection="column">
        <Text>
          {title} · {mode.kind === 'add' ? 'add' : 'edit'}
        </Text>
        <Form
          fields={fields}
          {...(editing === undefined ? {} : { initial: toForm(editing) })}
          onCancel={() => setMode({ kind: 'list' })}
          onSubmit={(values) => {
            const item = fromForm(values)
            if (mode.kind === 'add') {
              onChange([...items, item])
              setCursor(items.length)
            } else onChange(items.map((existing, i) => (i === mode.index ? item : existing)))
            setMode({ kind: 'list' })
          }}
        />
      </Box>
    )
  }

  const start = Math.max(0, Math.min(cursor - Math.floor(window / 2), items.length - window))
  const shown = items.slice(start, start + window)
  return (
    <Box flexDirection="column">
      <Text>
        {title} <Text dimColor>({items.length})</Text>
      </Text>
      {items.length === 0 && <Text dimColor>{`  ${empty}`}</Text>}
      {start > 0 && <Text dimColor>  …</Text>}
      {shown.map((item, i) => (
        <Text key={start + i}>
          {start + i === cursor ? '❯ ' : '  '}
          {describe(item)}
        </Text>
      ))}
      {start + window < items.length && <Text dimColor>  …</Text>}
      <Hint>{items.length ? '↑↓ move · a add · enter edit · d delete · esc back' : 'a add · esc back'}</Hint>
    </Box>
  )
}
