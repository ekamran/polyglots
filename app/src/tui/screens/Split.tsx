import { basename } from 'node:path'
import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { partCount, type SplitSummary } from '../../commands/split.js'
import { countEntries, poEntryCount } from '../../po/count.js'
import { useCommands } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useTask } from '../hooks/useTask.js'

export interface SplitProps {
  cwd: string
  onBack: () => void
}

const PO_EXTENSIONS = ['.po']
const DEFAULT_SIZE = '500'

// Only digits reach the field. A size is compared against an entry count and
// used to slice, so a stray character would otherwise surface as NaN parts.
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function Split({ cwd, onBack }: SplitProps) {
  const commands = useCommands()
  const [file, setFile] = useState<string>()
  const [entries, setEntries] = useState<number>()
  const [size, setSize] = useState(DEFAULT_SIZE)
  const task = useTask<SplitSummary>()

  const running = task.state.status === 'running'
  const finished = task.state.status === 'done' || task.state.status === 'error'
  const asked = Number(size)
  const valid = Number.isInteger(asked) && asked > 0
  const parts = valid && entries !== undefined ? partCount(entries, asked) : undefined

  useBackKeys(onBack, { enabled: !running, onEnter: finished ? onBack : undefined })

  const pick = (path: string) => {
    setFile(path)
    setEntries(countEntries(path))
  }

  // Enter reaches this only through the size field's own submit. Binding it a
  // second time with useInput ran the split twice on one keypress, and the
  // second run met the folder the first had just filled.
  const start = () => {
    if (!valid || file === undefined || running) return
    task.run(() => commands.splitPo({ file, size: asked }))
  }

  return (
    <Box flexDirection="column">
      <Text bold>Split {file === undefined ? 'a .po file' : basename(file)}</Text>

      {file === undefined && (
        <>
          <FilePicker dir={cwd} extensions={PO_EXTENSIONS} onPick={pick} annotate={poEntryCount} />
          <Hint>{BACK_HINT}</Hint>
        </>
      )}

      {file !== undefined && !finished && (
        <>
          <Text dimColor>
            {entries === undefined ? 'Could not count its entries' : `${entries} entries`}
          </Text>
          <Box>
            <Text>Entries per part: </Text>
            <TextInput value={size} onChange={(v) => setSize(digitsOnly(v))} onSubmit={start} />
          </Box>
          {/* What the number means before committing to it: the whole point of
              splitting is choosing a run size, and that is a part count. */}
          {parts !== undefined && (
            <Text dimColor>
              {parts === 1 ? 'one part, the whole file' : `${parts} parts, last one ${entries! - (parts - 1) * asked}`}
            </Text>
          )}
          {!valid && <Text color="yellow">Enter how many entries each part should hold.</Text>}
          {running && <Text>Splitting…</Text>}
          <Hint>{BACK_HINT}</Hint>
        </>
      )}

      {task.state.status === 'done' && (
        <>
          <Text bold>
            {task.state.result.entries} entries into {task.state.result.parts.length} parts.
          </Text>
          <Text>Wrote {task.state.result.dir}</Text>
          {task.state.result.leftBehind.length > 0 && (
            <Text color="yellow">
              Left alone, not part of this split: {task.state.result.leftBehind.join(', ')}
            </Text>
          )}
          <Hint>{DONE_HINT}</Hint>
        </>
      )}

      {task.state.status === 'error' && (
        <>
          <Text color="red">Split failed: {task.state.message}</Text>
          <Hint>{DONE_HINT}</Hint>
        </>
      )}
    </Box>
  )
}
