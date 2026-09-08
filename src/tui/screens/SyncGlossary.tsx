import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import type { SyncGlossaryResult } from '../../commands/glossary-sync.js'
import { normalizeLocale } from '../../tmx/parse.js'
import { useCommands, useConfig } from '../commands.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useTask } from '../hooks/useTask.js'

export interface SyncGlossaryProps {
  onBack: () => void
}

export function SyncGlossary({ onBack }: SyncGlossaryProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [locale, setLocale] = useState(config.defaultLocale)
  const task = useTask<SyncGlossaryResult>()

  const editing = task.state.status === 'idle'
  const running = task.state.status === 'running'
  const failed = task.state.status === 'error'
  const finished = !editing && !running

  useBackKeys(onBack, { enabled: !running, allowQ: !editing, onEnter: failed ? task.reset : finished ? onBack : undefined })

  const submit = (value: string) => {
    const normalized = normalizeLocale(value)
    if (normalized.length === 0) return
    setLocale(normalized)
    task.run(() => commands.syncGlossary({ locale: normalized }))
  }

  return (
    <Box flexDirection="column">
      <Text bold>Sync glossary from translate.wordpress.org</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      <Box>
        <Text>Locale: </Text>
        {editing ? <TextInput value={locale} onChange={setLocale} onSubmit={submit} /> : <Text>{locale}</Text>}
      </Box>
      {editing && <Hint>enter to sync · esc back to menu</Hint>}
      {running && <Text>Fetching glossary for {locale}…</Text>}
      {task.state.status === 'done' && (
        <Text bold>
          Synced {task.state.result.entries} glossary entries for {locale}.
        </Text>
      )}
      {failed && <Text color="red">Sync failed: {task.state.status === 'error' ? task.state.message : ''}</Text>}
      {failed ? <Hint>enter to edit the locale and retry · q/esc back to menu</Hint> : finished && <Hint>{DONE_HINT}</Hint>}
    </Box>
  )
}
