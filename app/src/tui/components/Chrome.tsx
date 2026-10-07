import { Box, Text } from 'ink'
import { TOKENS } from '../../ui/tokens.js'
import { WORDMARK } from '../../ui/wordmark.js'
import { VERSION } from '../../version.js'
import { ASCII_GLYPHS } from '../../ui/glyphs.js'
import type { KeyHelp } from '../keys.js'
import { STEP_LABELS, type SetupStatus } from '../setup.js'
import { SETUP_STEPS, type SetupStep } from '../state.js'
import { useGlyphs } from '../theme.js'

// The frame's top and bottom: wordmark and status above, keys and the run
// indicator below. Kept apart from the screens so every screen gets them
// without drawing them itself.

export interface HeaderProps {
  wordmark: boolean
  provider: string
  model?: string
  status: SetupStatus
  // The step the setup status has focus on, when home has moved focus there.
  focusedStep?: SetupStep
}

function StepMark({ step, status, focused }: { step: SetupStep; status: SetupStatus; focused: boolean }) {
  const glyphs = useGlyphs()
  const state = status.steps[step]
  const mark = state === 'done' ? glyphs.ok : state === 'missing' ? glyphs.fail : '?'
  const token = state === 'done' ? TOKENS.success : state === 'missing' ? TOKENS.warn : TOKENS.muted
  return (
    <Text>
      {focused ? <Text {...TOKENS.accent.ink}>{glyphs.next} </Text> : ' '}
      <Text {...token.ink}>{mark}</Text> <Text bold={focused}>{STEP_LABELS[step]}</Text>
    </Text>
  )
}

function ProviderLine({ provider, model }: { provider: string; model?: string | undefined }) {
  return (
    <Text wrap="truncate-end">
      <Text {...TOKENS.muted.ink}>review</Text> {provider}
      {model ? <Text {...TOKENS.muted.ink}> · {model}</Text> : null}
    </Text>
  )
}

function SetupLine({ status, focusedStep }: { status: SetupStatus; focusedStep?: SetupStep | undefined }) {
  return (
    <Text wrap="truncate-end">
      <Text {...TOKENS.muted.ink}>setup</Text>{' '}
      <Text {...(status.done === status.total ? TOKENS.success.ink : TOKENS.warn.ink)}>
        {status.done}/{status.total}
      </Text>
      {SETUP_STEPS.map((step) => (
        <StepMark key={step} step={step} status={status} focused={focusedStep === step} />
      ))}
    </Text>
  )
}

const Version = () => (
  <Text>
    <Text {...TOKENS.heading.ink}>polyglots</Text> <Text {...TOKENS.muted.ink}>{VERSION}</Text>
  </Text>
)

export function Header({ wordmark, provider, model, status, focusedStep }: HeaderProps) {
  const glyphs = useGlyphs()
  // Narrow terminals stack the status under the name: side by side, the
  // setup line alone is wider than the space beside the wordmark.
  if (!wordmark || glyphs === ASCII_GLYPHS) {
    return (
      <Box flexDirection="column" width="100%" flexShrink={0}>
        <Box justifyContent="space-between">
          <Version />
          <ProviderLine provider={provider} model={model} />
        </Box>
        <SetupLine status={status} focusedStep={focusedStep} />
      </Box>
    )
  }
  return (
    <Box justifyContent="space-between" width="100%" flexShrink={0}>
      <Box flexDirection="column" flexShrink={0}>
        {WORDMARK.map((line, i) => (
          <Text key={i} {...TOKENS.accent.ink}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" alignItems="flex-end">
        <Version />
        <ProviderLine provider={provider} model={model} />
        <SetupLine status={status} focusedStep={focusedStep} />
      </Box>
    </Box>
  )
}

export interface FooterProps {
  keys: KeyHelp[]
  busy: boolean
  statsUrl?: string
}

export function Footer({ keys, busy, statsUrl }: FooterProps) {
  const glyphs = useGlyphs()
  return (
    <Box width="100%" justifyContent="space-between" flexShrink={0}>
      <Text wrap="truncate-end">
        {keys.map((k, i) => (
          <Text key={i}>
            {i > 0 ? '  ' : ''}
            <Text {...TOKENS.accent.ink}>{k.keys}</Text> <Text {...TOKENS.muted.ink}>{k.does}</Text>
          </Text>
        ))}
      </Text>
      <Box flexShrink={0}>
        {statsUrl ? (
          <Text>
            {' '}
            <Text {...TOKENS.success.ink}>{glyphs.bullet}</Text> <Text {...TOKENS.muted.ink}>stats {statsUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</Text>
          </Text>
        ) : null}
        {busy ? (
          <Text>
            {' '}
            <Text {...TOKENS.warn.ink}>{glyphs.bullet}</Text> running
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}
