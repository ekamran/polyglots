import { useState } from 'react'
import { Box, Text } from 'ink'
import { usableProviders, type AgentStatus } from '../../agent/discover.js'
import { PROVIDERS } from '../../agent/providers.js'
import type { ReviewChoice } from '../../types.js'
import { TOKENS } from '../../ui/tokens.js'
import { MenuGrid, moveFocus } from '../components/MenuGrid.js'
import { useKeys, type GroupHandlers } from '../hooks/useKeys.js'
import type { Key } from '../input.js'
import type { MenuNode, ScreenId } from '../menu.js'
import type { SetupStatus } from '../setup.js'
import { SETUP_STEPS, type SetupStep } from '../state.js'

/**
 * The provider `p` moves to. Wraps, so one key reaches every candidate
 * however many there are.
 *
 * With `usable` undefined, because discovery has not finished or could not
 * run, every provider is a candidate, so the menu never waits on a spawn.
 * Otherwise the candidates are the usable ones plus the current one, in
 * PROVIDERS order, and the result is `current` itself when nothing else
 * qualifies.
 *
 * The experimental local reviewer is not in PROVIDERS, so from `local` this
 * moves to the first candidate agent and nothing ever moves to `local`: it is
 * reached only by `config set reviewProvider local`, never by a key that
 * cycles. With no usable agent at all it stays put.
 */
export function nextProvider(current: ReviewChoice, usable?: readonly ReviewChoice[]): ReviewChoice {
  const pool: readonly ReviewChoice[] =
    usable === undefined ? PROVIDERS : PROVIDERS.filter((p) => p === current || usable.includes(p))
  if (pool.length === 0) return current
  const at = pool.indexOf(current)
  return pool[(at + 1) % pool.length]!
}

export interface MenuScreenProps {
  items: MenuNode[]
  layout: 'grid' | 'list'
  width: number
  onOpen: (id: ScreenId) => void
  // q, and esc on a submenu. On home this quits; on a submenu it goes back.
  onLeave: () => void
}

/**
 * Cards, arrows, hotkeys and enter: what home and both submenus share. Home
 * passes its provider key in `extra`, matched before the card letters so p
 * never opens a card.
 */
function useMenuKeys(
  { items, layout, onOpen, onLeave }: MenuScreenProps,
  active: boolean,
  extra?: GroupHandlers<'home'>,
  escLeaves = true,
) {
  const [focus, setFocus] = useState(0)
  const move = (_input: string, key: Key) => {
    const dir = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : 'right'
    setFocus((f) => moveFocus(f, items.length, layout, dir))
  }
  useKeys(
    {
      // Esc is "back", and home has nowhere to go back to. Quitting on it
      // would turn a stray press, or one too many on the way out of a
      // submenu, into the end of the session.
      back: { esc: escLeaves ? onLeave : undefined, q: onLeave },
      home: { provider: extra?.provider },
      menu: {
        open: () => onOpen(items[focus]!.id),
        move,
        // A hotkey opens its card at once rather than only moving to it: the
        // letter is printed on the card, and a second keystroke to confirm what
        // the person already named would only slow down the commonest path.
        hotkey: (input) => {
          const hit = items.find((n) => n.key === input)
          if (!hit) return false
          onOpen(hit.id)
        },
      },
    },
    { isActive: active },
  )
  return focus
}

export function Submenu(props: MenuScreenProps) {
  const focus = useMenuKeys(props, true)
  return <MenuGrid items={props.items} focus={focus} layout={props.layout} width={props.width} />
}

export interface HomeProps extends MenuScreenProps {
  provider: ReviewChoice
  // Persisted by the caller rather than here, so this screen stays something
  // that can be rendered without writing to the user's config.
  onProvider: (next: ReviewChoice) => void
  // Shown when the choice could not be saved. The displayed provider does not
  // move in that case: a run reads the saved config, so showing the new one
  // would name an agent no review is going to use.
  providerError?: string
  // Undefined until discovery has an answer, and for good if it failed.
  agents?: AgentStatus[]
  checking?: boolean
  // The provider the config named at launch. Always kept in the rotation, so
  // that `p` can return to it after a switch away even when it is unusable:
  // the choice was the person's, and the menu does not get to erase it.
  configured?: ReviewChoice
  status: SetupStatus
  // Where focus sits in the header's setup status, held by the app because
  // the header draws it; undefined while focus is on the cards.
  statusFocus?: SetupStep
  onStatusFocus: (step: SetupStep | undefined) => void
  onOpenStep: (step: SetupStep) => void
}

export function Home(props: HomeProps) {
  const { provider, onProvider, providerError, agents, checking, configured, status, statusFocus, onStatusFocus, onOpenStep } = props
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const usable = agents === undefined ? undefined : [...usableProviders(agents), ...(configured ? [configured] : [])]
  const unusable = (agents ?? []).filter((a) => !a.usable)
  const current = agents?.find((a) => a.provider === provider)
  const others = unusable.filter((a) => a.provider !== provider)

  const onCards = statusFocus === undefined
  const focus = useMenuKeys(
    props,
    onCards,
    {
      provider: () => {
        const next = nextProvider(provider, usable)
        if (next === provider) {
          const why = others.map((a) => `${a.provider}: ${a.reason ?? 'unavailable'}`).join('; ')
          setNotice(`No other usable agent${why ? `: ${why}` : ''}`)
          return
        }
        setNotice(undefined)
        onProvider(next)
      },
    },
    false,
  )

  // Tab toggles between the cards and the setup status. On the status, the
  // arrows walk the five steps and enter opens the wizard at the one chosen,
  // which is how "selecting a step jumps to the fix" reads with a keyboard.
  useKeys({
    homeTab: {
      setup: () => {
        if (onCards) onStatusFocus(SETUP_STEPS.find((s) => status.steps[s] !== 'done') ?? SETUP_STEPS[0])
        else onStatusFocus(undefined)
      },
    },
  })
  const at = statusFocus === undefined ? 0 : SETUP_STEPS.indexOf(statusFocus)
  useKeys(
    {
      setupStatus: {
        leave: () => onStatusFocus(undefined),
        move: (_input, key) =>
          onStatusFocus(
            key.leftArrow || key.upArrow ? SETUP_STEPS[Math.max(0, at - 1)] : SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, at + 1)],
          ),
        open: () => statusFocus && onOpenStep(statusFocus),
      },
    },
    { isActive: !onCards },
  )

  // One line under the cards for whatever needs saying, most urgent first:
  // there is no room at 80x24 for a list of them.
  const line = providerError
    ? { token: TOKENS.warn, text: `Could not save that: ${providerError}` }
    : notice
      ? { token: TOKENS.warn, text: notice }
      : current && !current.usable
        ? { token: TOKENS.warn, text: current.reason ?? 'unavailable' }
        : checking
          ? { token: TOKENS.muted, text: 'Checking agents…' }
          : others.length > 0
            ? { token: TOKENS.muted, text: `Unavailable: ${others.map((a) => `${a.provider} (${a.reason ?? 'unavailable'})`).join(', ')}` }
            : undefined

  return (
    <Box flexDirection="column">
      <MenuGrid items={props.items} focus={focus} layout={props.layout} width={props.width} active={onCards} />
      {line && (
        <Text {...line.token.ink} wrap="truncate-end">
          {line.text}
        </Text>
      )}
    </Box>
  )
}
