import { basename } from 'node:path'
import { useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TranslateEvent, TranslateSummary } from '../../commands/translate.js'
import { normalizeLocale } from '../../tmx/parse.js'
import type { DraftEngineChoice } from '../../types.js'
import { useCommands, useConfig } from '../commands.js'
import { poEntryCount } from '../../po/count.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { Progress } from '../components/Progress.js'
import { useTask } from '../hooks/useTask.js'
import { createRunControl, type RunControl } from '../../run-control.js'
import { batchAdvice } from '../../agent/providers.js'
import { batchSizeChoices } from '../batch-size.js'

export interface TranslateProps {
  cwd: string
  onBack: () => void
}

type Phase = 'pick' | 'options' | 'confirm' | 'running'
type Mode = 'pending' | 'all'
type Engine = DraftEngineChoice

const PO_EXTENSIONS = ['.po']
const MODES: Mode[] = ['pending', 'all']
const ENGINES: Engine[] = ['deepl', 'openai', 'qwen']
const FIELD_MODE = 0
const FIELD_ENGINE = 1
const FIELD_LOCALE = 2
const FIELD_BATCH = 3
const FIELD_START = 4
const FIELD_COUNT = 5

function next<T>(values: T[], current: T, step: number): T {
  const i = values.indexOf(current)
  return values[(i + step + values.length) % values.length] as T
}

export function Translate({ cwd, onBack }: TranslateProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState('')
  const [mode, setMode] = useState<Mode>('pending')
  const [engine, setEngine] = useState<Engine>(config.defaultDraftEngine)
  const [locale, setLocale] = useState(config.defaultLocale)
  const [batchSize, setBatchSize] = useState(config.batchSize)
  const [focus, setFocus] = useState(FIELD_MODE)
  const [events, setEvents] = useState<TranslateEvent[]>([])
  // Held in a ref so a keypress reaches the run in flight without re-rendering
  // the whole screen on every state change.
  const control = useRef<RunControl | undefined>(undefined)
  const task = useTask<TranslateSummary>()

  const finished = phase === 'running' && task.state.status !== 'running'
  const stage = finished ? 'done' : phase
  const typing = stage === 'options' && focus === FIELD_LOCALE

  const isBack = (input: string, key: { escape: boolean; ctrl: boolean; meta: boolean }) =>
    key.escape || (!typing && input === 'q' && !key.ctrl && !key.meta)

  // Takes the locale rather than reading state, because the keypress that
  // starts a run normalises it in the same handler and would not see it yet.
  const start = (chosenLocale: string) => {
    setEvents([])
    setPhase('running')
    const run = createRunControl()
    control.current = run
    const unsubscribe = run.subscribe((state) => {
      if (state === 'paused') setEvents((prev) => [...prev, { type: 'paused', at: Date.now() }])
      if (state === 'running') setEvents((prev) => [...prev, { type: 'resumed', at: Date.now() }])
      // Without this, q registered silently and the screen went on looking
      // exactly like a run that had not heard it, for however long the batch in
      // flight still had to run.
      if (state === 'stopping') setEvents((prev) => [...prev, { type: 'stopping', at: Date.now() }])
    })
    task.run(() =>
      commands.translateFile({
        control: run,
        file,
        locale: chosenLocale,
        mode,
        draftEngine: engine,
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
    if (stage === 'confirm') {
      // [y/N]: only an explicit y starts; enter is No, so a double enter on "Start" cannot launch an all run
      if (input === 'y' || input === 'Y') start(locale)
      else if (input === 'n' || input === 'N' || key.return || isBack(input, key)) setPhase('options')
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
      const step = key.leftArrow ? -1 : 1
      if (focus === FIELD_MODE) setMode((m) => next(MODES, m, step))
      if (focus === FIELD_ENGINE) setEngine((e) => next(ENGINES, e, step))
      if (focus === FIELD_BATCH) setBatchSize((n) => next(batchSizeChoices(config.batchSize), n, step))
    } else if (key.return && focus !== FIELD_LOCALE) {
      if (focus === FIELD_START) {
        const normalized = normalizeLocale(locale)
        if (normalized.length > 0) {
          setLocale(normalized)
          // Only `all` asks again. It re-translates entries that already have a
          // translation, in a file translate saves in place, which is the one
          // data-loss path in the round trip. `pending` fills what is empty or
          // fuzzy and starts on the keypress, the way review does and the way
          // the translate command already behaves: its confirmation is scoped
          // to --all too.
          if (mode === 'all') setPhase('confirm')
          else start(normalized)
        }
      } else setFocus((f) => f + 1)
    }
  })

  const name = basename(file)
  const marker = (field: number) => (focus === field ? '❯ ' : '  ')

  return (
    <Box flexDirection="column">
      <Text bold>Translate {stage === 'pick' ? 'a .po file' : name}</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      {/* Named on every screen that runs or reports a job, so which
          subscription is being spent is never a guess. Not switchable here:
          the choice belongs to the menu, and changing it mid-file would split
          one submission's verdicts across two agents. */}
      {stage !== 'pick' && <Text dimColor>Provider: {config.reviewProvider}</Text>}

      {stage === 'pick' && (
        <>
          <FilePicker
            dir={cwd}
            extensions={PO_EXTENSIONS}
            annotate={poEntryCount}
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
          <Text>
            {marker(FIELD_MODE)}Mode:          {mode === 'pending' ? 'pending only (empty and fuzzy entries)' : 'all (re-translate every entry)'}
          </Text>
          <Text>
            {marker(FIELD_ENGINE)}Draft engine:  {engine}
          </Text>
          <Box>
            <Text>{marker(FIELD_LOCALE)}Locale:        </Text>
            {typing ? <TextInput value={locale} onChange={setLocale} onSubmit={() => setFocus(FIELD_BATCH)} /> : <Text>{locale}</Text>}
          </Box>
          <Text>
            {marker(FIELD_BATCH)}Batch size:    {batchSize} entries per draft and review call
          </Text>
          {/* The drafts are reviewed by the same agent a review run uses, so
              the same advice about a batch too small to be worth it applies. */}
          {batchAdvice(config.reviewProvider, batchSize) && (
            <Text color="yellow">{batchAdvice(config.reviewProvider, batchSize)}</Text>
          )}
          <Text>{marker(FIELD_START)}Start translation</Text>
          <Hint>↑↓ move · ←→ change · enter select · esc back to menu</Hint>
        </>
      )}

      {stage === 'confirm' && (
        <>
          <Text>
            {file} · mode {mode} · engine {engine} · locale {locale} · batch {batchSize}
          </Text>
          {mode === 'all' && <Text color="yellow">This will re-translate already-translated entries.</Text>}
          <Text>Continue? [y/N]</Text>
        </>
      )}

      {(stage === 'running' || stage === 'done') && (
        <>
          <Progress events={events} />
          {stage === 'running' && <Hint>p pause · r resume · q stop and keep what is done</Hint>}
          {task.state.status === 'error' && <Text color="red">Translation failed: {task.state.message}</Text>}
          {stage === 'done' && <Hint>{DONE_HINT}</Hint>}
        </>
      )}
    </Box>
  )
}
