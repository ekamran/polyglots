import { basename } from 'node:path'
import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { normalizeLocale } from '../../tmx/parse.js'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { useCommands, useConfig } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { ReviewProgress } from '../components/ReviewProgress.js'
import { useTask } from '../hooks/useTask.js'

export interface ReviewProps {
  cwd: string
  onBack: () => void
}

type Phase = 'pick' | 'options' | 'running'

const PO_EXTENSIONS = ['.po']
const FIELD_LOCALE = 0
const FIELD_NO_AI = 1
const FIELD_START = 2
const FIELD_COUNT = 3

export function Review({ cwd, onBack }: ReviewProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState('')
  const [locale, setLocale] = useState(config.defaultLocale)
  const [noAi, setNoAi] = useState(false)
  const [focus, setFocus] = useState(FIELD_LOCALE)
  const [events, setEvents] = useState<ReviewEvent[]>([])
  const task = useTask<ReviewSummary>()

  const finished = phase === 'running' && task.state.status !== 'running'
  const stage = finished ? 'done' : phase
  const typing = stage === 'options' && focus === FIELD_LOCALE

  const isBack = (input: string, key: { escape: boolean; ctrl: boolean; meta: boolean }) =>
    key.escape || (!typing && input === 'q' && !key.ctrl && !key.meta)

  const start = (chosenLocale: string) => {
    setEvents([])
    setPhase('running')
    task.run(() =>
      commands.reviewFile({
        file,
        locale: chosenLocale,
        noAi,
        onProgress: (e) => setEvents((prev) => [...prev, e]),
      }),
    )
  }

  // Stays subscribed during the run: Ink only reads stdin (and so only sees Ctrl+C)
  // while some useInput is active.
  useInput((input, key) => {
    if (stage === 'running') return
    if (isBack(input, key)) {
      onBack()
      return
    }
    if (stage === 'done' && key.return) {
      onBack()
      return
    }
    if (stage !== 'options') return

    if (key.upArrow || (key.tab && key.shift)) setFocus((f) => Math.max(0, f - 1))
    else if (key.downArrow || key.tab) setFocus((f) => Math.min(FIELD_COUNT - 1, f + 1))
    else if (key.leftArrow || key.rightArrow || (input === ' ' && !typing)) {
      if (focus === FIELD_NO_AI) setNoAi((v) => !v)
    } else if (key.return && focus !== FIELD_LOCALE) {
      if (focus === FIELD_START) {
        const normalized = normalizeLocale(locale)
        if (normalized.length > 0) {
          setLocale(normalized)
          start(normalized)
        }
      } else setFocus((f) => f + 1)
    }
  })

  const marker = (field: number) => (focus === field ? '❯ ' : '  ')

  return (
    <Box flexDirection="column">
      <Text bold>Review {stage === 'pick' ? 'a submitted .po file' : basename(file)}</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}

      {stage === 'pick' && (
        <>
          <FilePicker
            dir={cwd}
            extensions={PO_EXTENSIONS}
            onPick={(path) => {
              setFile(path)
              setPhase('options')
            }}
          />
          <Hint>{BACK_HINT}</Hint>
        </>
      )}

      {stage === 'options' && (
        <>
          <Box>
            <Text>{marker(FIELD_LOCALE)}Locale: </Text>
            {typing ? (
              <TextInput value={locale} onChange={setLocale} onSubmit={() => setFocus(FIELD_NO_AI)} />
            ) : (
              <Text>{locale}</Text>
            )}
          </Box>
          <Text>
            {marker(FIELD_NO_AI)}Skip AI checks: {noAi ? 'yes (rules only, fast)' : 'no (rules, then AI review)'}
          </Text>
          <Text>{marker(FIELD_START)}Start review</Text>
          <Hint>↑↓ move · ←→ change · enter select · esc back to menu</Hint>
        </>
      )}

      {(stage === 'running' || stage === 'done') && (
        <>
          <ReviewProgress events={events} />
          {task.state.status === 'error' && <Text color="red">Review failed: {task.state.message}</Text>}
          {stage === 'done' && <Hint>{DONE_HINT}</Hint>}
        </>
      )}
    </Box>
  )
}
