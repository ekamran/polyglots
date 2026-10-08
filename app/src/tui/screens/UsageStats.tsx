import { useState } from 'react'
import { Box, Text } from 'ink'
import { DEFAULT_CONFIG } from '../../config.js'
import type { PolyglotsConfig } from '../../types.js'
import { TOKENS } from '../../ui/tokens.js'
import { previewUsagePayload, resetUsageState, usageStatus, type UsageStatus } from '../../usage/index.js'
import { errorMessage, useCommands } from '../commands.js'
import { useBackKeys } from '../hooks/useBackKeys.js'
import { useKeys } from '../hooks/useKeys.js'
import { useGlyphs } from '../theme.js'

// The TUI's half of `config set usageStats` and `usage-stats show`: the
// setting, why it is what it is, and the payload it would send, so the
// decision is made looking at the data rather than at a description of it.
//
// Reads the usage module directly rather than through TuiCommands: it only
// reads the job store read-only and writes usage.json, both under
// POLYGLOTS_HOME, which every test already points at a temporary directory.

const SAY: Record<UsageStatus, string> = {
  on: 'On. This is what the next weekly send carries; nothing else leaves this machine.',
  off: 'Off: nothing is sent. Turned on, this is what would be.',
  unanswered: 'Off, never turned on: nothing is sent. Turned on, this is what would be.',
  'do-not-track': 'Off because DO_NOT_TRACK is set, whatever this setting says. Nothing is sent.',
}

export function UsageStats({ onBack }: { onBack: () => void }) {
  const commands = useCommands()
  const glyphs = useGlyphs()
  const [config, setConfig] = useState<Pick<PolyglotsConfig, 'usageStats'>>(() => {
    try {
      return commands.loadConfig()
    } catch {
      return DEFAULT_CONFIG
    }
  })
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  // Bumped after a reset, so the preview is built again with the new id.
  const [epoch, setEpoch] = useState(0)
  useBackKeys(onBack)
  useKeys({
    usageStats: {
      toggle: () => {
        try {
          setConfig(commands.saveConfig({ usageStats: config.usageStats !== true }))
          setError(undefined)
          setNote(undefined)
        } catch (err) {
          setError(errorMessage(err))
        }
      },
      reset: () => {
        setNote(resetUsageState() ? 'Install id forgotten. Totals already sent stay counted under the old one.' : 'There was no install id to forget.')
        setEpoch((e) => e + 1)
      },
    },
  })
  const status = usageStatus(config, process.env)
  // Built on every render that matters: it reads a few rows, and showing a
  // stale count beside a setting someone is deciding on would be worse.
  const preview = JSON.stringify(previewUsagePayload({ config, env: process.env }), null, 2)
  void epoch
  return (
    <Box flexDirection="column">
      <Text {...TOKENS.heading.ink}>Usage statistics</Text>
      <Text {...TOKENS.muted.ink} wrap="wrap">
        Anonymous all-time totals for the website: counts only, at most once a week. Never your locale, project names, file names,
        strings, wp.org username, provider or model.
      </Text>
      <Text> </Text>
      <Text>
        <Text {...TOKENS.accent.ink}>{glyphs.next}</Text> [{config.usageStats === true ? 'x' : ' '}] Share anonymous totals with the website
      </Text>
      <Text {...(status === 'on' ? TOKENS.success.ink : TOKENS.muted.ink)} wrap="wrap">
        {'      '}
        {SAY[status]}
      </Text>
      <Text> </Text>
      {preview.split('\n').map((line, i) => (
        <Text key={i} {...TOKENS.muted.ink}>
          {'  '}
          {line}
        </Text>
      ))}
      {note && <Text {...TOKENS.success.ink}>{note}</Text>}
      {error && <Text {...TOKENS.error.ink}>Could not save that: {error}</Text>}
    </Box>
  )
}
