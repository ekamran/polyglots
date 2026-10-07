import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { maskSecret } from '../../config.js'
import type { Secrets } from '../../types.js'
import { errorMessage, useCommands, type TuiCommands } from '../commands.js'
import { DONE_HINT, Hint } from '../components/Hint.js'
import { useBackKeys } from '../hooks/useBackKeys.js'

export interface ConfigureKeysProps {
  onBack: () => void
}

export const SECRET_NAMES: (keyof Secrets)[] = ['DEEPL_API_KEY', 'OPENAI_API_KEY']

type Outcome = 'saved' | 'kept'

interface LoadedSecrets {
  secrets: Secrets
  error?: string
}

function readSecrets(commands: TuiCommands): LoadedSecrets {
  try {
    return { secrets: commands.loadSecrets() }
  } catch (err) {
    return { secrets: {}, error: errorMessage(err) }
  }
}

const fromEnv = (name: keyof Secrets): boolean => typeof process.env[name] === 'string' && process.env[name] !== ''

export function ConfigureKeys({ onBack }: ConfigureKeysProps) {
  const commands = useCommands()
  const [loaded, setLoaded] = useState<LoadedSecrets>(() => readSecrets(commands))
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [outcomes, setOutcomes] = useState<Partial<Record<keyof Secrets, Outcome>>>({})
  const [error, setError] = useState<string>()

  const current = SECRET_NAMES[index]
  const finished = current === undefined

  useBackKeys(onBack, { allowQ: finished, onEnter: finished ? onBack : undefined })

  const submit = (raw: string) => {
    if (!current) return
    if (raw.length === 0) {
      setOutcomes((o) => ({ ...o, [current]: 'kept' }))
    } else {
      try {
        commands.saveSecret(current, raw)
        setLoaded(readSecrets(commands))
        setOutcomes((o) => ({ ...o, [current]: 'saved' }))
        setError(undefined)
      } catch (err) {
        setError(errorMessage(err))
        setValue('')
        return
      }
    }
    setValue('')
    setIndex(index + 1)
  }

  return (
    <Box flexDirection="column">
      <Text bold>Configure API keys</Text>
      <Text dimColor>Keys are written to the secrets file; existing values are shown masked.</Text>
      {loaded.error && <Text color="yellow">Could not read the secrets file: {loaded.error}</Text>}
      {SECRET_NAMES.map((name) => (
        <Text key={name}>
          {name === current ? '❯ ' : '  '}
          {name.padEnd(15)} {maskSecret(loaded.secrets[name]).padEnd(10)} {outcomes[name] ?? ''}
          {fromEnv(name) && <Text dimColor> (set by env var, overrides the file)</Text>}
        </Text>
      ))}
      {current && (
        <Box>
          <Text>New {current} (blank keeps current): </Text>
          <TextInput value={value} onChange={setValue} onSubmit={submit} mask="*" />
        </Box>
      )}
      {error && <Text color="red">Could not save: {error}</Text>}
      {finished ? <Hint>{DONE_HINT}</Hint> : <Hint>enter to confirm · esc back to menu</Hint>}
    </Box>
  )
}
