import { basename } from 'node:path'
import { useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { normalizeLocale } from '../../tmx/parse.js'
import { resolveLocale } from '../../wporg/locales.js'
import type { ReviewEvent, ReviewSummary } from '../../types.js'
import { agentBinOverride } from '../../agent/providers.js'
import { initialBatchSize, providerLabel, screenBatchAdvice } from '../local.js'
import { headerLocaleOf } from '../../cli/locale.js'
import { useCommands, useConfig } from '../commands.js'
import { poEntryCount } from '../../po/count.js'
import { FilePicker } from '../components/FilePicker.js'
import { BACK_HINT, DONE_HINT, Hint } from '../components/Hint.js'
import { ReviewProgress } from '../components/ReviewProgress.js'
import { appendEvent } from '../components/RecentEntries.js'
import { ScrollTarget } from '../components/Viewport.js'
import { useTask } from '../hooks/useTask.js'
import { createRunControl, type RunControl } from '../../run-control.js'
import { batchSizeChoices } from '../batch-size.js'
import { useKeys } from '../hooks/useKeys.js'
import { TextInput } from '../input.js'
import { useFooterStage } from '../footer-stage.js'

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

function step(values: number[], current: number, by: number): number {
  const i = values.indexOf(current)
  return values[(i + by + values.length) % values.length] ?? current
}

export function Review({ cwd, onBack }: ReviewProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState('')
  // Empty with no locale configured, and then filled from the picked file's
  // Language header when that names one locale for certain (headerLocaleOf).
  const [locale, setLocale] = useState(config.defaultLocale ?? '')
  // The locale read from the picked file, kept to say so beside the field.
  const [headerLocale, setHeaderLocale] = useState<string | undefined>(undefined)
  // Antigravity's lookup server takes its locale from config when it starts
  // and never hears one read from a file (resolveFileLocale says why), so the
  // header is not offered for it.
  const headerAllowed = config.defaultLocale === undefined && config.reviewProvider !== 'antigravity'
  const [noAi, setNoAi] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [batchSize, setBatchSize] = useState(initialBatchSize(config))
  const [focus, setFocus] = useState(FIELD_LOCALE)
  const [events, setEvents] = useState<ReviewEvent[]>([])
  // Held in a ref so a keypress reaches the run in flight without re-rendering
  // the whole screen on every state change.
  const control = useRef<RunControl | undefined>(undefined)
  const task = useTask<ReviewSummary>()

  const finished = phase === 'running' && task.state.status !== 'running'
  const stage = finished ? 'done' : phase
  const typing = stage === 'options' && focus === FIELD_LOCALE
  useFooterStage(stage)

  const start = (chosenLocale: string) => {
    setEvents([])
    setPhase('running')
    // The binary the Check AI agents screen and the menu gate reported on, so a
    // run spawns what discovery checked rather than whatever is first on PATH.
    // Resolved at start rather than at mount, the moment the CLI resolves it.
    const bin = agentBinOverride(config.reviewProvider, process.env)
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
      commands.reviewFile({
        control: run,
        file,
        locale: chosenLocale,
        noAi,
        fresh,
        batchSize,
        ...(bin === undefined ? {} : { bin }),
        // Bounded: a long run's per-entry events would otherwise all stay in memory.
        onProgress: (e) => setEvents((prev) => appendEvent(prev, e)),
      }).finally(unsubscribe),
    )
  }

  // Stays subscribed during the run: Ink only reads stdin (and so only sees Ctrl+C)
  // while some useInput is active.
  const running = stage === 'running'
  const options = stage === 'options'
  useKeys({
    // Pausing parks the run after the batch in flight, so the call already paid
    // for still finishes and saves.
    run: {
      pause: running ? () => control.current?.pause() : undefined,
      resume: running ? () => control.current?.resume() : undefined,
      stop: running ? () => control.current?.stop() : undefined,
    },
    back: { esc: running ? undefined : onBack, q: running || typing ? undefined : onBack },
    finished: { close: stage === 'done' ? onBack : undefined },
    runForm: {
      move: options
        ? (_input, key) =>
            key.upArrow || (key.tab && key.shift) ? setFocus((f) => Math.max(0, f - 1)) : setFocus((f) => Math.min(FIELD_COUNT - 1, f + 1))
        : undefined,
      change: options
        ? (input, key) => {
            if (input === ' ' && typing) return false
            if (focus === FIELD_NO_AI) setNoAi((v) => !v)
            else if (focus === FIELD_FRESH) setFresh((v) => !v)
            else if (focus === FIELD_BATCH) {
              setBatchSize((n) => step(batchSizeChoices(initialBatchSize(config)), n, key.leftArrow ? -1 : 1))
            }
          }
        : undefined,
      select:
        options && focus !== FIELD_LOCALE
          ? () => {
              if (focus === FIELD_START) {
                const normalized = resolveLocale(locale)?.id ?? normalizeLocale(locale)
                if (normalized.length > 0) {
                  setLocale(normalized)
                  start(normalized)
                }
              } else setFocus((f) => f + 1)
            }
          : undefined,
    },
  })

  const marker = (field: number) => (focus === field ? '❯ ' : '  ')

  return (
    <Box flexDirection="column">
      <Text bold>Review {stage === 'pick' ? 'a submitted .po file' : basename(file)}</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      {/* Named on every screen that runs or reports a job, so which
          subscription is being spent is never a guess. Not switchable here:
          the choice belongs to the menu, and changing it mid-file would split
          one submission's verdicts across two agents. */}
      {stage !== 'pick' && <Text dimColor>Provider: {providerLabel(config.reviewProvider)}</Text>}

      {stage === 'pick' && (
        <>
          <FilePicker
            dir={cwd}
            extensions={PO_EXTENSIONS}
            annotate={poEntryCount}
            onPick={(path) => {
              setFile(path)
              if (headerAllowed) {
                void headerLocaleOf(path).then((found) => {
                  if (!found) return
                  setHeaderLocale(found)
                  // Only into an empty field: the header is read after the
                  // form opens, and must not overwrite what was typed since.
                  setLocale((current) => (current.trim() === '' ? found : current))
                })
              }
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
          {headerLocale !== undefined && locale === headerLocale && <Text dimColor>  From the file's Language header.</Text>}
          {locale.trim() === '' && config.reviewProvider === 'antigravity' && config.defaultLocale === undefined && (
            <Text color="yellow">  With Antigravity reviewing, type the locale: its lookup server never hears one read from the file.</Text>
          )}
          {locale.trim() === '' && !(config.reviewProvider === 'antigravity' && config.defaultLocale === undefined) && (
            <Text color="yellow">  No locale set: type the one you translate into, or choose it once in Setup.</Text>
          )}
          {/* Dimmed under "skip AI checks", where there are no batches to size.
              It still steps, so the choice survives toggling the AI back on. */}
          <Text dimColor={noAi}>
            {marker(FIELD_BATCH)}Batch size:      {batchSize} entries per AI call
          </Text>
          {/* Where the size is chosen, because shrinking the batch is the
              obvious response to a timeout and the wrong one on this agent. */}
          {screenBatchAdvice(config, batchSize, locale) && (
            <Text color="yellow">{screenBatchAdvice(config, batchSize, locale)}</Text>
          )}
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
          <ReviewProgress events={events} wporgUsername={config.wporgUsername} />
          {/* Kept in view when failed batches make the screen taller than the
              body: these keys are how the run is stopped. */}
          {stage === 'running' && (
            <ScrollTarget active>
              <Hint>p pause · r resume · q stop and keep what is done</Hint>
            </ScrollTarget>
          )}
          {task.state.status === 'error' && <Text color="red">Review failed: {task.state.message}</Text>}
          {stage === 'done' && <Hint>{DONE_HINT}</Hint>}
        </>
      )}
    </Box>
  )
}
