import { basename } from 'node:path'
import { useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { normalizeLocale } from '../../tmx/parse.js'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { useCommands, useConfig } from '../commands.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { ReviewProgress } from '../components/ReviewProgress.js'
import { useTask } from '../hooks/useTask.js'
import { createRunControl, type RunControl } from '../../run-control.js'

export interface ReviewProps {
  cwd: string
  onBack: () => void
}

type Phase = 'pick' | 'options' | 'running'

const PO_EXTENSIONS = ['.po']
const FIELD_LOCALE = 0
const FIELD_BATCH = 1
const FIELD_NO_AI = 2
const FIELD_FRESH = 3
const FIELD_START = 4
const FIELD_COUNT = 5

const BATCH_SIZES = [10, 25, 50, 75, 100]

// A locale team can set any batch size in config.json, and whatever they set has
// to stay reachable after the first keypress, so it joins the ladder in order.
export function batchSizeChoices(configured: number): number[] {
  if (BATCH_SIZES.includes(configured)) return BATCH_SIZES
  return [...BATCH_SIZES, configured].sort((a, b) => a - b)
}

function step(values: number[], current: number, by: number): number {
  const i = values.indexOf(current)
  return values[(i + by + values.length) % values.length] ?? current
}

export function Review({ cwd, onBack }: ReviewProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState('')
  const [locale, setLocale] = useState(config.defaultLocale)
  const [noAi, setNoAi] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [batchSize, setBatchSize] = useState(config.batchSize)
  const [focus, setFocus] = useState(FIELD_LOCALE)
  const [events, setEvents] = useState<ReviewEvent[]>([])
  // Held in a ref so a keypress reaches the run in flight without re-rendering
  // the whole screen on every state change.
  const control = useRef<RunControl | undefined>(undefined)
  const task = useTask<ReviewSummary>()

  const finished = phase === 'running' && task.state.status !== 'running'
  const stage = finished ? 'done' : phase
  const typing = stage === 'options' && focus === FIELD_LOCALE

  const isBack = (input: string, key: { escape: boolean; ctrl: boolean; meta: boolean }) =>
    key.escape || (!typing && input === 'q' && !key.ctrl && !key.meta)

  const start = (chosenLocale: string) => {
    setEvents([])
    setPhase('running')
    const run = createRunControl()
    control.current = run
    const unsubscribe = run.subscribe((state) => {
      if (state === 'paused') setEvents((prev) => [...prev, { type: 'paused', at: Date.now() }])
      if (state === 'running') setEvents((prev) => [...prev, { type: 'resumed', at: Date.now() }])
    })
    task.run(() =>
      commands.reviewFile({
        control: run,
        file,
        locale: chosenLocale,
        noAi,
        fresh,
        batchSize,
        onProgress: (e) => setEvents((prev) => [...prev, e]),
      }).finally(unsubscribe),
    )
  }

  // Stays subscribed during the run: Ink only reads stdin (and so only sees Ctrl+C)
  // while some useInput is active.
  useInput((input, key) => {
    if (stage === 'running') {
      const run = control.current
      if (!run) return
      // Pausing parks the run after the batch in flight, so the call already paid
      // for still finishes and saves.
      if (input === 'p') run.pause()
      else if (input === 'r') run.resume()
      else if (input === 'q') run.stop()
      return
    }
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
      else if (focus === FIELD_FRESH) setFresh((v) => !v)
      else if (focus === FIELD_BATCH) {
        setBatchSize((n) => step(batchSizeChoices(config.batchSize), n, key.leftArrow ? -1 : 1))
      }
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
            <Text>{marker(FIELD_LOCALE)}Locale:          </Text>
            {typing ? (
              <TextInput value={locale} onChange={setLocale} onSubmit={() => setFocus(FIELD_BATCH)} />
            ) : (
              <Text>{locale}</Text>
            )}
          </Box>
          {/* Dimmed under "skip AI checks", where there are no batches to size.
              It still steps, so the choice survives toggling the AI back on. */}
          <Text dimColor={noAi}>
            {marker(FIELD_BATCH)}Batch size:      {batchSize} entries per AI call
          </Text>
          <Text>
            {marker(FIELD_NO_AI)}Skip AI checks:  {noAi ? 'yes (rules only, fast)' : 'no (rules, then AI review)'}
          </Text>
          {/* A review that was interrupted picks up from the marker in its
              problems file. This is the way to make it forget that and start
              from the first batch again. */}
          <Text>
            {marker(FIELD_FRESH)}Start over:      {fresh ? 'yes (ignore saved progress)' : 'no (resume if interrupted)'}
          </Text>
          <Text>{marker(FIELD_START)}Start review</Text>
          <Hint>↑↓ move · ←→ change · enter select · esc back to menu</Hint>
        </>
      )}

      {(stage === 'running' || stage === 'done') && (
        <>
          <ReviewProgress events={events} />
          {stage === 'running' && <Hint>p pause · r resume · q stop and keep what is done</Hint>}
          {task.state.status === 'error' && <Text color="red">Review failed: {task.state.message}</Text>}
          {stage === 'done' && <Hint>{DONE_HINT}</Hint>}
        </>
      )}
    </Box>
  )
}
