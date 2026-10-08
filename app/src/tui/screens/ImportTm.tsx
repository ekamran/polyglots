import { basename } from 'node:path'
import { useState } from 'react'
import { Box, Text } from 'ink'
import type { TmImportProgress, TmImportResult } from '../../commands/tm-import.js'
import { useCommands, useConfig } from '../commands.js'
import { NeedsLocale } from '../components/NeedsLocale.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useKeys } from '../hooks/useKeys.js'
import { useTask } from '../hooks/useTask.js'
import type { Locale } from '../../types.js'

export interface ImportTmProps {
  // Opens setup at the locale step; see NeedsLocale.
  onSetup?: () => void
  cwd: string
  onBack: () => void
}

// The .po exports translate.wordpress.org hands out import as well as TMX, so
// the picker offers both; leaving .po out made the menu import less than the CLI.
const TM_EXTENSIONS = ['.tmx', '.po']
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function ImportTm(props: ImportTmProps) {
  const { config } = useConfig()
  if (config.defaultLocale === undefined) {
    return (
      <NeedsLocale
        title="Import Translation Memory"
        needs="Importing a memory"
        onBack={props.onBack}
        {...(props.onSetup === undefined ? {} : { onSetup: props.onSetup })}
      />
    )
  }
  return <ImportTmInLocale {...props} locale={config.defaultLocale} />
}

function ImportTmInLocale({ cwd, onBack, locale }: ImportTmProps & { locale: Locale }) {
  const commands = useCommands()
  const { error: configError } = useConfig()
  const [file, setFile] = useState<string>()
  const [progress, setProgress] = useState<TmImportProgress[]>([])
  const task = useTask<TmImportResult>()

  const running = task.state.status === 'running'
  const finished = task.state.status === 'done' || task.state.status === 'error'

  useBackKeys(onBack, { enabled: !running })
  useKeys({ finished: { close: finished ? onBack : undefined } })

  const pick = (path: string) => {
    setFile(path)
    setProgress([])
    task.run(() =>
      commands.importTmx([path], {
        locale: locale,
        onProgress: (e) => setProgress((prev) => [...prev, e]),
      }),
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>Import Translation Memory (.tmx or .po) · locale {locale}</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      {file === undefined && (
        <>
          <FilePicker dir={cwd} extensions={TM_EXTENSIONS} onPick={pick} />
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
