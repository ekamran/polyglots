import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { useState } from 'react'
import { Box, Text } from 'ink'
import { DEFAULT_STATS_FILE, type StatsSummary } from '../../commands/stats.js'
import { useCommands } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useTask } from '../hooks/useTask.js'
import { openInDefaultApp } from '../open-file.js'
import { TextInput, useInput } from '../input.js'

export interface StatsProps {
  cwd: string
  onBack: () => void
}

// The page is written wherever the picker was left, under whatever the name
// field says. A name typed with a path in it wins, so someone who knows exactly
// where they want it is not made to walk there.
export function statsTarget(dir: string, name: string): string {
  const typed = name.trim()
  if (typed.length === 0) return join(dir, DEFAULT_STATS_FILE)
  return isAbsolute(typed) || typed.includes('/') ? resolve(dir, typed) : join(dir, typed)
}

export function Stats({ cwd, onBack }: StatsProps) {
  const commands = useCommands()
  const [dir, setDir] = useState(cwd)
  const [name, setName] = useState(DEFAULT_STATS_FILE)
  const [picking, setPicking] = useState(false)
  const [opened, setOpened] = useState(false)
  const task = useTask<StatsSummary>()

  const editing = task.state.status === 'idle' && !picking
  const running = task.state.status === 'running'
  const failed = task.state.status === 'error'
  // The finished state itself, not a boolean: a boolean does not narrow the
  // union, so every read of the summary below would have to re-test the status.
  const done = task.state.status === 'done' ? task.state : undefined

  useBackKeys(picking ? () => setPicking(false) : onBack, {
    enabled: !running,
    allowQ: !editing,
    onEnter: failed ? task.reset : done ? onBack : undefined,
  })

  // Tab rather than a letter: the name field has focus here, and ink-text-input
  // types any printable key into it. A letter opened the picker and left itself
  // behind in the file name, which is how `polyglots-stats.htmlf` happened.
  // Tab is one of the few keys that field deliberately ignores, and it is
  // already how the review screen moves between its own controls.
  useInput(
    (_input, key) => {
      if (key.tab) setPicking(true)
    },
    { isActive: editing },
  )

  useInput(
    (input) => {
      if (input === 'o' && task.state.status === 'done') {
        setOpened(openInDefaultApp(task.state.result.file))
      }
    },
    { isActive: task.state.status === 'done' },
  )

  const submit = () => {
    const file = statsTarget(dir, name)
    setDir(dirname(file))
    setName(basename(file))
    task.run(() => commands.writeStats({ out: file }))
  }

  if (picking) {
    return (
      <Box flexDirection="column">
        <Text bold>Review statistics · where should the page go?</Text>
        <FilePicker dir={dir} extensions={[]} chooseDir onPick={(path) => { setDir(path); setPicking(false) }} />
        <Hint>enter to use the highlighted folder · esc to go back</Hint>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>Review statistics</Text>
      <Box>
        <Text>
          Write to: <Text dimColor>{dir}/</Text>
        </Text>
        {editing ? <TextInput value={name} onChange={setName} onSubmit={submit} /> : <Text>{name}</Text>}
      </Box>
      {editing && <Hint>enter to write the page · tab choose folder · esc back to menu</Hint>}
      {running && <Text>Reading the run history…</Text>}
      {done &&
        (done.result.submissions === 0 && done.result.translateRuns === 0 ? (
          <Box flexDirection="column">
            <Text bold>Nothing recorded yet.</Text>
            <Text dimColor>Wrote {done.result.file} anyway; it will fill in as you work.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {done.result.submissions > 0 && (
              <Text bold>
                {done.result.submissions} submissions reviewed, {done.result.entries} entries.
              </Text>
            )}
            {done.result.translateRuns > 0 && (
              <Text bold>
                {done.result.translateRuns} translate runs, {done.result.translateEntries} entries drafted.
              </Text>
            )}
            <Text>Wrote {done.result.file}</Text>
            {done.result.incomplete > 0 && (
              <Text dimColor>
                {done.result.incomplete} unfinished{' '}
                {done.result.incomplete === 1 ? 'review is' : 'reviews are'} left out of the totals.
              </Text>
            )}
          </Box>
        ))}
      {done && (
        <>
          <Text dimColor>o to open it in a browser</Text>
          {opened && <Text color="green">Opening it now.</Text>}
        </>
      )}
      {failed && <Text color="red">Could not write the page: {task.state.status === 'error' ? task.state.message : ''}</Text>}
      {failed ? <Hint>enter to try again · q/esc back to menu</Hint> : done && <Hint>{DONE_HINT}</Hint>}
    </Box>
  )
}
