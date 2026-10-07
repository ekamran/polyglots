import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import {
  LISTING_ONLY,
  matchesModel,
  modelFacts,
  normalizeBaseUrl,
  sanitizeDisplay,
  serverLabel,
  unavailableLine,
  type LocalModel,
  type ModelServer,
} from '../../draft/discover.js'
import { errorMessage, useCommands, useConfig } from '../commands.js'
import { Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'

export interface LocalModelsProps {
  onBack: () => void
}

interface Choice {
  server: ModelServer
  model: LocalModel
}

// Ollama models only, in display order. A name that needed sanitising is shown
// but left out: it is not the name Ollama would be asked for.
function choicesOf(servers: ModelServer[] | undefined): Choice[] {
  return (servers ?? [])
    .filter((s) => s.state === 'up' && s.selectable)
    .flatMap((server) => server.models.filter((m) => sanitizeDisplay(m.name) === m.name).map((model) => ({ server, model })))
}

/**
 * Which local model servers answer, and which Ollama model drafts with.
 *
 * The choice is a saved setting, like the review provider, so it lives here
 * rather than as a field on the Translate screen. A per-run override there
 * would need a new translateFile option threaded into the engine id, and is
 * deferred.
 *
 * The cursor is hand-rolled rather than a SelectInput, because the models
 * are grouped under their server and a SelectInput is one flat list: with two
 * Ollama servers, the headers that say which is which would have nowhere to
 * go. Only Ollama models are on it. Anything else is listed dim, since saving
 * an LM Studio id into `ollama.model` would fail on the first batch, which is
 * the failure this screen exists to prevent.
 */
export function LocalModels({ onBack }: LocalModelsProps) {
  const commands = useCommands()
  const { config } = useConfig()
  const [servers, setServers] = useState<ModelServer[] | undefined>(undefined)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  // Moves only once the save succeeds: a run reads the saved config, so a
  // marker that moved on a failed save would name a model no run will load.
  const [current, setCurrent] = useState(config.ollama)
  const [cursor, setCursor] = useState(0)
  // The latest request wins, so a slow first answer cannot land on top of a
  // re-check that already came back.
  const latest = useRef(0)

  const choices = choicesOf(servers)

  const isCurrent = (server: ModelServer, model: LocalModel) =>
    server.target.baseUrl === normalizeBaseUrl(current.baseUrl) && matchesModel(current.model, model)

  const check = (refresh: boolean) => {
    const id = ++latest.current
    setChecking(true)
    // Called inside a promise executor so that a throw, from any
    // implementation of the command, lands in the same failed-check branch as
    // a rejection instead of escaping the effect or the key handler. The saved
    // config is deliberately not passed from useConfig: that one falls back to
    // the defaults when the file will not load, so passing it would probe the
    // default servers and hide the broken file the person needs to hear about.
    new Promise<ModelServer[]>((resolve) => resolve(commands.discoverModels(refresh ? { refresh: true } : undefined)))
      .then(
        (result) => {
          if (id !== latest.current) return
          setServers(result)
          setError(undefined)
          const at = choicesOf(result).findIndex((c) => isCurrent(c.server, c.model))
          setCursor(at < 0 ? 0 : at)
        },
        (err: unknown) => id === latest.current && setError(errorMessage(err)),
      )
      .finally(() => id === latest.current && setChecking(false))
  }

  useEffect(() => {
    check(false)
    return () => {
      latest.current += 1
    }
  }, [])

  const choose = (choice: Choice) => {
    // The configured URL is kept as it was typed when the model came from
    // that server, so saving a model never rewrites the URL beside it. A model
    // from another Ollama brings its server along, or the run would ask the
    // configured one for a model it does not have.
    const sameServer = choice.server.target.baseUrl === normalizeBaseUrl(current.baseUrl)
    const next = { baseUrl: sameServer ? current.baseUrl : choice.server.target.baseUrl, model: choice.model.name }
    try {
      commands.saveConfig({ ollama: next })
      setCurrent(next)
      setSaveError(undefined)
    } catch (err) {
      setSaveError(errorMessage(err))
    }
  }

  useBackKeys(onBack)
  useInput((input, key) => {
    if (input === 'r' && !checking) {
      check(true)
      return
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
    else if (key.downArrow) setCursor((c) => Math.min(Math.max(0, choices.length - 1), c + 1))
    else if (key.return && choices[cursor]) choose(choices[cursor]!)
  })

  const up = (servers ?? []).filter((s) => s.state === 'up')
  const notUp = (servers ?? []).filter((s) => s.state !== 'up')
  const selected = choices[cursor]

  return (
    <Box flexDirection="column">
      <Text bold>Local models</Text>
      <Text dimColor>
        Draft model: {current.model} at {current.baseUrl}
      </Text>
      {checking && <Text dimColor>Checking local model servers…</Text>}
      {error && <Text color="red">Could not check local models: {error}</Text>}
      {servers && up.length === 0 && (
        <Text color="yellow">
          No local model server found. Start Ollama with `ollama serve`, or add a URL with `polyglots config set
          localModelServers`.
        </Text>
      )}
      {up.map((server) => {
        const names = server.models.map((m) => sanitizeDisplay(m.name))
        const nameWidth = Math.max(0, ...names.map((n) => n.length)) + 2
        const facts = server.models.map(modelFacts)
        const widths = [0, 1, 2].map((i) => Math.max(0, ...facts.map((f) => f[i]!.length)))
        return (
          <Box key={server.target.baseUrl} flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{serverLabel(server)}</Text> <Text dimColor>{server.target.baseUrl}</Text>
            </Text>
            {!server.selectable && <Text dimColor>  {LISTING_ONLY}</Text>}
            {server.models.length === 0 && <Text dimColor>  no models</Text>}
            {server.models.map((model, i) => {
              const name = names[i]!
              if (!server.selectable) {
                return (
                  <Text key={`${i}:${name}`} dimColor>
                    {'    '}
                    {name}
                  </Text>
                )
              }
              const columns = facts[i]!.map((f, c) => (c === 0 ? f.padStart(widths[c]!) : f.padEnd(widths[c]!))).join('  ')
              const pointed = selected !== undefined && selected.server === server && selected.model === model
              const usable = name === model.name
              return (
                <Text key={`${i}:${name}`} {...(usable ? {} : { dimColor: true })}>
                  {pointed ? '❯ ' : '  '}
                  {name.padEnd(nameWidth)}
                  {columns}
                  {isCurrent(server, model) ? '  (current)' : ''}
                </Text>
              )
            })}
          </Box>
        )
      })}
      {notUp.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {notUp.map((server) => (
            <Text key={server.target.baseUrl} dimColor>
              {unavailableLine(server)}
            </Text>
          ))}
        </Box>
      )}
      {saveError && <Text color="yellow">Could not save that: {saveError}</Text>}
      <Box marginTop={1}>
        <Hint>{`${choices.length > 0 ? '↑↓ move · enter use this model · ' : ''}r re-check · esc/q back to menu`}</Hint>
      </Box>
    </Box>
  )
}
