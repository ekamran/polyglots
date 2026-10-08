import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { DEFAULT_STATS_FILE, type StatsSummary } from '../../commands/stats.js'
import { TOKENS } from '../../ui/tokens.js'
import { errorMessage, useCommands } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useKeys } from '../hooks/useKeys.js'
import { useTask } from '../hooks/useTask.js'
import { useServices, useStatsError, useStatsUrl } from '../services.js'
import { portInUseWarning } from '../../stats/server.js'
import { openInDefaultApp } from '../open-file.js'
import { TextInput } from '../input.js'

export interface StatsExportProps {
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

export function StatsExport({ cwd, onBack }: StatsExportProps) {
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
  })
  useKeys({ retry: { again: failed ? task.reset : undefined }, finished: { close: done ? onBack : undefined } })

  // Tab rather than a letter: the name field has focus here, and ink-text-input
  // types any printable key into it. A letter opened the picker and left itself
  // behind in the file name, which is how `polyglots-stats.htmlf` happened.
  // Tab is one of the few keys that field deliberately ignores, and it is
  // already how the review screen moves between its own controls.
  useKeys({ target: { folder: () => setPicking(true) } }, { isActive: editing })

  useKeys({ statsExport: { open: done ? () => setOpened(openInDefaultApp(done.result.file)) : undefined } }, { isActive: done !== undefined })

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
      <Text bold>Review statistics · standalone copy</Text>
      <Box>
        <Text>
          Write to: <Text dimColor>{dir}/</Text>
        </Text>
        {editing ? <TextInput value={name} onChange={setName} onSubmit={submit} /> : <Text>{name}</Text>}
      </Box>
      {editing && <Hint>enter to write the page · tab choose folder · esc back</Hint>}
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

export interface StatsProps {
  cwd: string
  onBack: () => void
}

type Serving = { state: 'starting' } | { state: 'up' } | { state: 'stopped' } | { state: 'failed'; message: string }

/**
 * The live statistics page. Opening the screen starts the server, or finds
 * the one already running; leaving it keeps the server up so the browser tab
 * keeps working, and the footer says so. It stops on x or when the app quits.
 * w writes a standalone copy, which is what this screen did before there was
 * a server.
 */
export function Stats({ cwd, onBack }: StatsProps) {
  const commands = useCommands()
  const services = useServices()
  const url = useStatsUrl()
  const [serving, setServing] = useState<Serving>(url ? { state: 'up' } : { state: 'starting' })
  const [exporting, setExporting] = useState(false)
  const [opened, setOpened] = useState<boolean | undefined>(undefined)
  const serverError = useStatsError()

  const start = () => {
    setServing({ state: 'starting' })
    let wanted = true
    services
      // Errors go to the services, not this screen's state: the server
      // outlives the screen, and a request that fails after it is left
      // would otherwise be reported into an unmounted component.
      .startStats(() => commands.startStatsServer({ onError: (err) => services.reportStatsError(err.message) }))
      .then(
        () => wanted && setServing({ state: 'up' }),
        (err: unknown) => wanted && setServing({ state: 'failed', message: errorMessage(err) }),
      )
    return () => {
      wanted = false
    }
  }
  useEffect(() => (url ? undefined : start()), [])

  useBackKeys(onBack, { enabled: !exporting })
  useKeys(
    {
      stats: {
        write: () => setExporting(true),
        // The URL stays on screen either way; this only says whether a
        // browser could be asked, which over SSH it cannot.
        open: url ? () => void commands.openInBrowser(url).then(setOpened) : undefined,
        stop: serving.state === 'up' ? () => void services.stopStats().then(() => setServing({ state: 'stopped' })) : undefined,
        serve: serving.state === 'stopped' || serving.state === 'failed' ? () => void start() : undefined,
      },
    },
    { isActive: !exporting },
  )

  if (exporting) return <StatsExport cwd={cwd} onBack={() => setExporting(false)} />

  return (
    <Box flexDirection="column">
      <Text bold>Review statistics</Text>
      {serving.state === 'starting' && <Text>Starting the stats server…</Text>}
      {serving.state === 'up' && url && (
        <>
          <Text>
            Serving at <Text {...TOKENS.path.ink}>{url}</Text>
          </Text>
          {services.stats?.sharedWith === undefined && (
            <Text {...TOKENS.muted.ink}>Only this machine can reach it. It keeps serving after you leave this screen, until you press x or quit.</Text>
          )}
          {services.stats?.sharedWith !== undefined && (
            <Text {...TOKENS.muted.ink}>
              Served by another polyglots (pid {services.stats.sharedWith.pid}), which keeps it running until that one quits.
            </Text>
          )}
          {services.stats?.portInUse !== undefined && (
            <Text {...TOKENS.warn.ink}>{portInUseWarning(services.stats.portInUse, services.stats.port)}</Text>
          )}
          {opened === true && <Text {...TOKENS.success.ink}>Opening it in the browser.</Text>}
          {opened === false && <Text {...TOKENS.warn.ink}>No browser to open here; copy the address above.</Text>}
        </>
      )}
      {serving.state === 'stopped' && <Text>Stopped. s to serve it again.</Text>}
      {serving.state === 'failed' && (
        <Text {...TOKENS.error.ink}>Could not start the stats server: {serving.message} · s to try again · w still writes a copy</Text>
      )}
      {serverError && <Text {...TOKENS.warn.ink}>The server reported: {serverError}</Text>}
      <Hint>{url ? 'o open in browser · w write a standalone copy · x stop serving · esc back' : 'w write a standalone copy · esc back'}</Hint>
    </Box>
  )
}
