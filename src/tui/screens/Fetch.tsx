import { useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { agentBinOverride, batchAdvice } from '../../agent/providers.js'
import { MAX_PARALLEL, runProjects, withSharedDbs } from '../../commands/batch.js'
import { defaultOutDir, type Ready, type Resolution } from '../../commands/fetch.js'
import {
  describeResolution,
  endOfJob,
  endOfResolution,
  tallyLine,
  tallyOf,
  waitNotice,
  type BatchSummary,
  type ProjectEnd,
} from '../../commands/fetch-report.js'
import { createRunControl, type RunControl } from '../../run-control.js'
import type { DraftEngineChoice } from '../../types.js'
import { parseProjectLines, type FetchStatus } from '../../wporg/projects.js'
import { batchSizeChoices } from '../batch-size.js'
import { useCommands, useConfig } from '../commands.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useTask } from '../hooks/useTask.js'

export interface FetchProps {
  onBack: () => void
}

type Stage = 'list' | 'get' | 'resolving' | 'resolved' | 'options' | 'running' | 'done'

const ENGINES: DraftEngineChoice[] = ['deepl', 'openai', 'qwen']

// The fields differ by action, so each list is spelled out rather than one list
// with entries hidden: the cursor index then always names a field on screen.
type Field = 'parallel' | 'batch' | 'fresh' | 'noAi' | 'engine' | 'start'
const REVIEW_FIELDS: Field[] = ['parallel', 'batch', 'fresh', 'noAi', 'start']
const TRANSLATE_FIELDS: Field[] = ['parallel', 'batch', 'engine', 'fresh', 'start']

// A project's line while the batch runs.
interface Live {
  state: 'queued' | 'running' | 'finished'
  batch?: string
}

interface Finished {
  inputs: string[]
  ends: ProjectEnd[]
}

function next<T>(values: T[], current: T, step: number): T {
  const i = values.indexOf(current)
  return values[(i + step + values.length) % values.length] as T
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Fetch a list of projects from translate.wordpress.org and review or translate
 * every one, from the menu.
 *
 * The steps follow the CLI's: the list, what to get, how each project resolved,
 * the action's options, the run, and a table of how each ended. What to get is
 * asked before the list is checked rather than after, because the check depends
 * on it: a plugin's branch is the one with more strings in that status, and a
 * project with nothing in it is skipped.
 */
export function Fetch({ onBack }: FetchProps) {
  const commands = useCommands()
  const { config, error: configError } = useConfig()
  const [stage, setStage] = useState<Stage>('list')
  const [lines, setLines] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [status, setStatus] = useState<FetchStatus>('waiting')
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [resolveError, setResolveError] = useState<string | undefined>(undefined)
  // The latest backoff, shown under the checking and downloading lines.
  const [waiting, setWaiting] = useState<string | undefined>(undefined)
  const [focus, setFocus] = useState(0)
  const [parallel, setParallel] = useState(1)
  const [batchSize, setBatchSize] = useState(config.batchSize)
  const [fresh, setFresh] = useState(false)
  const [noAi, setNoAi] = useState(false)
  const [engine, setEngine] = useState<DraftEngineChoice>(config.defaultDraftEngine)
  const [phase, setPhase] = useState<'downloading' | 'running'>('downloading')
  const [live, setLive] = useState<Map<string, Live>>(new Map())
  const [paused, setPaused] = useState<'running' | 'paused' | 'stopping'>('running')
  const control = useRef<RunControl | undefined>(undefined)
  const task = useTask<Finished>()

  const locale = config.defaultLocale
  const review = status === 'waiting'
  const fields = review ? REVIEW_FIELDS : TRANSLATE_FIELDS
  const ready = resolutions.filter((r): r is Ready => r.state === 'ready')
  const shown = stage === 'running' && task.state.status !== 'running' ? 'done' : stage

  const resolve = (chosen: FetchStatus) => {
    setStage('resolving')
    setResolveError(undefined)
    commands
      .resolveProjects(parseProjectLines(lines.join('\n')), {
        locale,
        status: chosen,
        onWait: (ms) => setWaiting(waitNotice(ms)),
      })
      .then(setResolutions, (err: unknown) => setResolveError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setWaiting(undefined)
        setStage('resolved')
      })
  }

  const start = () => {
    setStage('running')
    setPhase('downloading')
    const run = createRunControl()
    control.current = run
    run.subscribe(setPaused)
    task.run(async () => {
      const ends = new Map<string, ProjectEnd>()
      for (const r of resolutions) {
        const end = endOfResolution(r, status)
        if (end) ends.set(r.input, end)
      }
      const fetched = await commands.fetchProjects(ready, {
        locale,
        status,
        outDir: defaultOutDir(),
        onWait: (ms) => setWaiting(waitNotice(ms)),
      })
      setWaiting(undefined)
      const toRun = fetched.flatMap((f) => {
        if (f.state === 'failed') {
          ends.set(f.input, { tally: 'failed', detail: `download failed: ${f.reason}` })
          return []
        }
        return [f]
      })
      const inputOf = new Map(toRun.map((f) => [f.file, f.input]))
      setLive(new Map(toRun.map((f) => [f.input, { state: 'queued' }])))
      setPhase('running')
      const mark = (input: string, patch: Partial<Live>) =>
        setLive((prev) => new Map(prev).set(input, { ...(prev.get(input) ?? { state: 'queued' }), ...patch }))
      const onProgress = (file: string) => (e: { type: string; index?: number; of?: number }) => {
        if (e.type === 'batch-start' && e.index !== undefined && e.of !== undefined) {
          mark(inputOf.get(file)!, { batch: `batch ${e.index}/${e.of}` })
        }
      }

      // Translate's review pass and a review both run the configured provider,
      // so every project spawns the binary discovery checked, as the CLI's
      // fetch does, rather than whatever is first on PATH.
      const bin = agentBinOverride(config.reviewProvider, process.env)
      if (toRun.length > 0) {
        const outcomes = await withSharedDbs(({ db, jobsDb }) =>
          runProjects<BatchSummary>(
            toRun.map((f) => f.file),
            {
              parallel,
              control: run,
              run: (file, c) =>
                review
                  ? commands.reviewFile({
                      control: c,
                      db,
                      jobsDb,
                      file,
                      locale,
                      batchSize,
                      ...(bin === undefined ? {} : { bin }),
                      ...(noAi ? { noAi: true } : {}),
                      ...(fresh ? { fresh: true } : {}),
                      onProgress: onProgress(file),
                    })
                  : commands.translateFile({
                      control: c,
                      db,
                      jobsDb,
                      file,
                      locale,
                      mode: 'pending',
                      draftEngine: engine,
                      batchSize,
                      ...(bin === undefined ? {} : { bin }),
                      ...(fresh ? { fresh: true } : {}),
                      onProgress: onProgress(file),
                    }),
              onEvent: (e) => {
                if (e.type === 'project-start') mark(inputOf.get(e.file)!, { state: 'running' })
                else mark(inputOf.get(e.outcome.file)!, { state: 'finished' })
              },
            },
          ),
        )
        for (const o of outcomes) ends.set(inputOf.get(o.file)!, endOfJob(o, config.wporgUsername))
      }
      const inputs = resolutions.map((r) => r.input)
      return {
        inputs,
        ends: inputs.map((i): ProjectEnd => ends.get(i) ?? { tally: 'failed', detail: 'never ran' }),
      }
    })
  }

  // A pasted list arrives as one chunk with its line breaks in it, so a chunk is
  // split rather than taken as one line.
  const type = (input: string) => {
    const parts = (current + input).split(/\r\n|\r|\n/)
    const complete = parts.slice(0, -1).map((l) => l.trim()).filter((l) => l !== '')
    if (complete.length > 0) setLines((prev) => [...prev, ...complete])
    setCurrent(parts[parts.length - 1]!)
  }

  useInput((input, key) => {
    if (shown === 'running') {
      const run = control.current
      if (!run) return
      if (input === 'p') run.pause()
      else if (input === 'r') run.resume()
      else if (input === 'q') run.stop()
      return
    }

    if (shown === 'list') {
      // Only escape leaves: q is a letter that slugs contain.
      if (key.escape) return onBack()
      if (key.return || (key.ctrl && input === 'd')) {
        const line = current.trim()
        if (line !== '' && !(key.ctrl && input === 'd')) {
          setLines((prev) => [...prev, line])
          setCurrent('')
          return
        }
        const all = line === '' ? lines : [...lines, line]
        if (parseProjectLines(all.join('\n')).length > 0) {
          setLines(all)
          setCurrent('')
          setStage('get')
        }
        return
      }
      if (key.backspace || key.delete) {
        if (current.length > 0) setCurrent((c) => c.slice(0, -1))
        else if (lines.length > 0) {
          setCurrent(lines[lines.length - 1]!)
          setLines((prev) => prev.slice(0, -1))
        }
        return
      }
      if (input && !key.ctrl && !key.meta) type(input)
      return
    }

    if (key.escape || (input === 'q' && !key.ctrl && !key.meta)) return onBack()
    if (shown === 'done' && key.return) return onBack()

    if (shown === 'get') {
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || input === ' ') {
        setStatus((s) => (s === 'waiting' ? 'untranslated' : 'waiting'))
      } else if (key.return) resolve(status)
      return
    }

    if (shown === 'resolved') {
      if (!key.return) return
      if (ready.length === 0) return onBack()
      setFocus(0)
      setStage('options')
      return
    }

    if (shown !== 'options') return
    const field = fields[focus]!
    if (key.upArrow || (key.tab && key.shift)) setFocus((f) => Math.max(0, f - 1))
    else if (key.downArrow || key.tab) setFocus((f) => Math.min(fields.length - 1, f + 1))
    else if (key.leftArrow || key.rightArrow || input === ' ') {
      const step = key.leftArrow ? -1 : 1
      // Parallel stops at its ends instead of wrapping: wrapping from eight to
      // one on a held key would quietly turn a fast batch into a slow one.
      if (field === 'parallel') setParallel((n) => Math.min(MAX_PARALLEL, Math.max(1, n + step)))
      if (field === 'batch') setBatchSize((n) => next(batchSizeChoices(config.batchSize), n, step))
      if (field === 'engine') setEngine((e) => next(ENGINES, e, step))
      if (field === 'fresh') setFresh((v) => !v)
      if (field === 'noAi') setNoAi((v) => !v)
    } else if (key.return) {
      if (field === 'start') start()
      else setFocus((f) => f + 1)
    }
  })

  const marker = (field: Field) => (fields[focus] === field ? '❯ ' : '  ')
  const width = Math.max(0, ...resolutions.map((r) => r.input.length))
  const action = review ? 'Review' : 'Translate'

  return (
    <Box flexDirection="column">
      <Text bold>Fetch from translate.wordpress.org</Text>
      {configError && <Text color="yellow">Config error, using defaults: {configError}</Text>}
      {shown !== 'list' && shown !== 'get' && <Text dimColor>Provider: {config.reviewProvider} · locale {locale}</Text>}

      {shown === 'list' && (
        <>
          <Text>Projects, one per line: a slug or a translate.wordpress.org URL</Text>
          {lines.map((line, i) => (
            <Text key={i}>  {line}</Text>
          ))}
          <Text>
            ❯ {current}
            <Text inverse> </Text>
          </Text>
          <Hint>enter adds a line · enter on an empty line continues · esc back to menu</Hint>
        </>
      )}

      {shown === 'get' && (
        <>
          <Text>What to get for {plural(parseProjectLines(lines.join('\n')).length, 'project', 'projects')}:</Text>
          <Text>{status === 'waiting' ? '❯ ' : '  '}Waiting strings, to review</Text>
          <Text>{status === 'untranslated' ? '❯ ' : '  '}Untranslated strings, to translate</Text>
          <Hint>↑↓ choose · enter check the list · esc back to menu</Hint>
        </>
      )}

      {shown === 'resolving' && <Text>Checking {plural(lines.length, 'project', 'projects')}...</Text>}
      {(shown === 'resolving' || (shown === 'running' && phase === 'downloading')) && waiting && (
        <Text color="yellow">{waiting}</Text>
      )}

      {shown === 'resolved' && (
        <>
          {resolveError && <Text color="red">Could not check the list: {resolveError}</Text>}
          {resolutions.map((r) => (
            <Text key={r.input} {...(r.state === 'ready' ? {} : { dimColor: true, strikethrough: r.state !== 'unreachable' })}>
              {'  '}
              {r.input.padEnd(width)}
              {'  '}
              {describeResolution(r, status)}
            </Text>
          ))}
          {ready.length === 0 ? (
            <>
              <Text color="yellow">Nothing to do: no project on the list has {status} strings.</Text>
              <Hint>{DONE_HINT}</Hint>
            </>
          ) : (
            <Hint>enter to continue · esc back to menu</Hint>
          )}
        </>
      )}

      {shown === 'options' && (
        <>
          <Text>
            {marker('parallel')}Parallel:      {parallel} {parallel === 1 ? 'project at a time' : 'projects at once'}
          </Text>
          <Text>
            {marker('batch')}Batch size:    {batchSize} entries per call
          </Text>
          {batchAdvice(config.reviewProvider, batchSize) && (
            <Text color="yellow">{batchAdvice(config.reviewProvider, batchSize)}</Text>
          )}
          {!review && (
            <Text>
              {marker('engine')}Draft engine:  {engine}
            </Text>
          )}
          <Text>
            {marker('fresh')}Start over:    {fresh ? 'yes, ignore what is cached' : 'no, reuse what is cached'}
          </Text>
          {review && (
            <Text>
              {marker('noAi')}Skip AI:       {noAi ? 'yes, rules only' : 'no'}
            </Text>
          )}
          <Text>
            {marker('start')}
            {action} {plural(ready.length, 'project', 'projects')}
          </Text>
          <Text dimColor>   Saves to {defaultOutDir()}</Text>
          <Hint>↑↓ move · ←→ change · enter select · esc back to menu</Hint>
        </>
      )}

      {shown === 'running' && (
        <>
          {phase === 'downloading' ? (
            <Text>Downloading {plural(ready.length, 'export', 'exports')}...</Text>
          ) : (
            [...live].map(([input, l]) => (
              <Text key={input} {...(l.state === 'queued' ? { dimColor: true } : {})}>
                {'  '}
                {input.padEnd(width)}
                {'  '}
                {l.state === 'running' ? `running${l.batch ? ` · ${l.batch}` : ''}` : l.state === 'queued' ? 'queued' : 'finished'}
              </Text>
            ))
          )}
          {paused === 'paused' && <Text color="yellow">Paused. Running projects stop after their current batch.</Text>}
          {paused === 'stopping' && (
            <Text color="yellow">Stopping after the current batches. Queued projects will not start.</Text>
          )}
          <Hint>p pause · r resume · q stop and keep what is done</Hint>
        </>
      )}

      {shown === 'done' && (
        <>
          {task.state.status === 'error' && <Text color="red">The batch failed: {task.state.message}</Text>}
          {task.state.status === 'done' && (
            <>
              {task.state.result.inputs.map((input, i) => {
                const end = task.state.status === 'done' ? task.state.result.ends[i]! : undefined
                if (!end) return null
                const color = end.tally === 'failed' ? 'red' : end.tally === 'done' ? 'green' : undefined
                return (
                  <Text key={input}>
                    {'  '}
                    {input.padEnd(width)}
                    {'  '}
                    <Text {...(color ? { color } : {})}>{end.tally}</Text> {end.detail}
                  </Text>
                )
              })}
              <Text bold>{tallyLine(tallyOf(task.state.result.ends))}</Text>
              {task.state.result.ends.map((end, i) =>
                end.message ? (
                  <Box key={i} flexDirection="column" marginTop={1}>
                    <Text dimColor>Message for the requester ({task.state.status === 'done' ? task.state.result.inputs[i] : ''}):</Text>
                    <Text>{end.message}</Text>
                  </Box>
                ) : null,
              )}
            </>
          )}
          <Hint>{DONE_HINT}</Hint>
        </>
      )}
    </Box>
  )
}
