import { basename } from 'node:path'
import { useState } from 'react'
import { Box, Text } from 'ink'
import type { TmImportProgress, TmImportResult } from '../../commands/tm-import.js'
import { useCommands, useConfig } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useTask } from '../hooks/useTask.js'

export interface ImportTmProps {
  cwd: string
  onBack: () => void
}

const TMX_EXTENSIONS = ['.tmx']
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function ImportTm({ cwd, onBack }: ImportTmProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [file, setFile] = useState<string>()
  const [progress, setProgress] = useState<TmImportProgress[]>([])
  const task = useTask<TmImportResult>()

  const running = task.state.status === 'running'
  const finished = task.state.status === 'done' || task.state.status === 'error'

  useBackKeys(onBack, { enabled: !running, onEnter: finished ? onBack : undefined })

  const pick = (path: string) => {
    setFile(path)
    setProgress([])
    task.run(() =>
      commands.importTmx([path], {
        locale: config.defaultLocale,
        onProgress: (e) => setProgress((prev) => [...prev, e]),
      }),
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>Import Translation Memory (.tmx) · locale {config.defaultLocale}</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      {file === undefined && (
        <>
          <FilePicker dir={cwd} extensions={TMX_EXTENSIONS} onPick={pick} />
          <Hint>{BACK_HINT}</Hint>
        </>
      )}
      {file !== undefined && (
        <>
          {running && <Text>Importing {basename(file)}…</Text>}
          {progress.map((p) => (
            <Text key={p.file}>
              {basename(p.file)}: {count(p.entries, 'entry', 'entries')}, {p.upserted} new or updated
            </Text>
          ))}
          {task.state.status === 'done' && (
            <Text bold>
              Imported {count(task.state.result.entries, 'entry', 'entries')} ({task.state.result.upserted} new or updated) from{' '}
              {count(task.state.result.files, 'file', 'files')}.
            </Text>
          )}
          {task.state.status === 'error' && <Text color="red">Import failed: {task.state.message}</Text>}
          {finished && <Hint>{DONE_HINT}</Hint>}
        </>
      )}
    </Box>
  )
}
