import { useState } from 'react'
import { Box, Text } from 'ink'
import { configDir, dataDir } from '../../paths.js'
import { TOKENS } from '../../ui/tokens.js'
import { VERSION } from '../../version.js'
import { useCommands } from '../commands.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useInput } from '../input.js'
import { GLOBAL_KEYS, SCREEN_KEYS } from '../keys.js'
import { walk } from '../menu.js'
import { tuiStateFile, type TuiState } from '../state.js'
import { useGlyphs } from '../theme.js'

// Help, About and the interface settings: the three screens that only show
// or toggle something, gathered so each stays a few lines.

export const DOCS_HOME = 'https://ada.tools/polyglots/docs/'

interface Line {
  text: string
  kind: 'heading' | 'body' | 'key' | 'blank'
  keys?: string
}

/** The help page as lines, so it can scroll in whatever height the frame has. */
export function helpLines(): Line[] {
  const lines: Line[] = [
    { kind: 'heading', text: 'Everywhere' },
    ...GLOBAL_KEYS.map((k): Line => ({ kind: 'key', keys: k.keys, text: k.does })),
    { kind: 'blank', text: '' },
  ]
  for (const { node, keys } of walk()) {
    lines.push({ kind: 'heading', text: `${keys.join(' ')}  ${node.label}` })
    lines.push({ kind: 'body', text: node.help })
    for (const k of SCREEN_KEYS[node.id]) lines.push({ kind: 'key', keys: k.keys, text: k.does })
    lines.push({ kind: 'blank', text: '' })
  }
  lines.push({ kind: 'body', text: `More in the documentation: ${DOCS_HOME}` })
  return lines
}

export function Help({ height, onBack }: { height: number; onBack: () => void }) {
  const lines = helpLines()
  const room = Math.max(3, height - 1)
  const [top, setTop] = useState(0)
  const last = Math.max(0, lines.length - room)
  useBackKeys(onBack)
  useInput((_input, key) => {
    if (key.upArrow) setTop((t) => Math.max(0, t - 1))
    else if (key.downArrow) setTop((t) => Math.min(last, t + 1))
    else if (key.pageUp) setTop((t) => Math.max(0, t - room))
    else if (key.pageDown || _input === ' ') setTop((t) => Math.min(last, t + room))
  })
  return (
    <Box flexDirection="column">
      {lines.slice(top, top + room).map((l, i) =>
        l.kind === 'heading' ? (
          <Text key={i} {...TOKENS.heading.ink} wrap="truncate-end">
            {l.text}
          </Text>
        ) : l.kind === 'key' ? (
          <Text key={i} wrap="truncate-end">
            {'  '}
            <Text {...TOKENS.accent.ink}>{(l.keys ?? '').padEnd(12)}</Text> {l.text}
          </Text>
        ) : (
          <Text key={i} wrap="truncate-end">
            {l.text || ' '}
          </Text>
        ),
      )}
      <Text {...TOKENS.muted.ink}>
        ↑↓ scroll · space page · {top + 1}–{Math.min(lines.length, top + room)} of {lines.length} · esc back
      </Text>
    </Box>
  )
}

export function About({ onBack }: { onBack: () => void }) {
  useBackKeys(onBack, { onEnter: onBack })
  const row = (label: string, value: string) => (
    <Text>
      <Text {...TOKENS.muted.ink}>{label.padEnd(10)}</Text> {value}
    </Text>
  )
  return (
    <Box flexDirection="column">
      <Text {...TOKENS.heading.ink}>polyglots {VERSION}</Text>
      <Text>Translates and reviews WordPress .po files with machine drafts, translation memory and AI review.</Text>
      <Text> </Text>
      {row('config', configDir())}
      {row('data', dataDir())}
      {row('docs', DOCS_HOME)}
      {row('source', 'https://github.com/emreerkan/polyglots')}
      {row('licence', 'MIT')}
    </Box>
  )
}

interface Setting {
  key: keyof TuiState['settings']
  label: string
  note: string
}

const SETTINGS: Setting[] = [
  {
    key: 'exitSummary',
    label: 'Print the last output path after quitting',
    note: 'The app draws on its own screen, which the terminal throws away on exit. This leaves one line behind naming the file the last run wrote.',
  },
]

export function Interface({ onBack }: { onBack: () => void }) {
  const commands = useCommands()
  const glyphs = useGlyphs()
  const [state, setState] = useState<TuiState>(() => commands.loadTuiState())
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string>()
  useBackKeys(onBack)
  useInput((input, key) => {
    if (key.upArrow) setAt((a) => Math.max(0, a - 1))
    else if (key.downArrow) setAt((a) => Math.min(SETTINGS.length - 1, a + 1))
    else if (key.return || input === ' ') {
      const setting = SETTINGS[at]!
      const next: TuiState = { ...state, settings: { ...state.settings, [setting.key]: !state.settings[setting.key] } }
      try {
        commands.saveTuiState(next)
        setState(next)
        setError(undefined)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  })
  return (
    <Box flexDirection="column">
      <Text {...TOKENS.heading.ink}>Interface settings</Text>
      <Text {...TOKENS.muted.ink}>Saved in {tuiStateFile()}, apart from the config the CLI reads.</Text>
      <Text> </Text>
      {SETTINGS.map((s, i) => (
        <Box key={s.key} flexDirection="column">
          <Text>
            <Text {...TOKENS.accent.ink}>{i === at ? glyphs.next : ' '}</Text> [{state.settings[s.key] ? 'x' : ' '}] {s.label}
          </Text>
          <Text {...TOKENS.muted.ink} wrap="wrap">
            {'      '}
            {s.note}
          </Text>
        </Box>
      ))}
      {error && <Text {...TOKENS.error.ink}>Could not save that: {error}</Text>}
    </Box>
  )
}
