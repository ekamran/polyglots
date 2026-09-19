import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { DEFAULT_STATS_FILE, type StatsSummary } from '../../commands/stats.js'
import { useCommands } from '../commands.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useTask } from '../hooks/useTask.js'

export interface StatsProps {
  onBack: () => void
}

export function Stats({ onBack }: StatsProps) {
  const commands = useCommands()
  const [out, setOut] = useState(DEFAULT_STATS_FILE)
  const task = useTask<StatsSummary>()

  const editing = task.state.status === 'idle'
  const running = task.state.status === 'running'
  const failed = task.state.status === 'error'
  const finished = !editing && !running

  useBackKeys(onBack, {
    enabled: !running,
    allowQ: !editing,
    onEnter: failed ? task.reset : finished ? onBack : undefined,
  })

  const submit = (value: string) => {
    const file = value.trim()
    if (file.length === 0) return
    setOut(file)
    task.run(() => commands.writeStats({ out: file }))
  }

  return (
    <Box flexDirection="column">
      <Text bold>Review statistics</Text>
      <Box>
        <Text>Write to: </Text>
        {editing ? <TextInput value={out} onChange={setOut} onSubmit={submit} /> : <Text>{out}</Text>}
      </Box>
      {editing && <Hint>enter to write the page · esc back to menu</Hint>}
      {running && <Text>Reading the run history…</Text>}
      {task.state.status === 'done' &&
        (task.state.result.submissions === 0 ? (
          <Box flexDirection="column">
            <Text bold>No finished reviews recorded yet.</Text>
            <Text dimColor>Wrote {task.state.result.file} anyway; it will fill in as you review.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>
              {task.state.result.submissions} submissions, {task.state.result.entries} entries.
            </Text>
            <Text>Wrote {task.state.result.file}. Open it in a browser.</Text>
            {task.state.result.incomplete > 0 && (
              <Text dimColor>
                {task.state.result.incomplete} unfinished{' '}
                {task.state.result.incomplete === 1 ? 'review is' : 'reviews are'} left out of the totals.
              </Text>
            )}
          </Box>
        ))}
      {failed && <Text color="red">Could not write the page: {task.state.status === 'error' ? task.state.message : ''}</Text>}
      {failed ? <Hint>enter to try again · q/esc back to menu</Hint> : finished && <Hint>{DONE_HINT}</Hint>}
    </Box>
  )
}
