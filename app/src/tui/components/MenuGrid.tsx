import { Box, Text } from 'ink'
import { ASCII_GLYPHS } from '../../ui/glyphs.js'
import { TOKENS } from '../../ui/tokens.js'
import { MAX_FRAME_COLUMNS } from '../size.js'
import type { MenuNode } from '../menu.js'
import { useGlyphs } from '../theme.js'

export interface MenuGridProps {
  items: MenuNode[]
  focus: number
  layout: 'grid' | 'list'
  width: number
  active?: boolean
}

// The widest a card gets. Beyond this a wide terminal only buys air around
// the grid, which reads better than two cards stretched to the edges.
const GAP = 1
// As wide as the frame lets two cards and the gap be.
const MAX_CARD = (MAX_FRAME_COLUMNS - GAP) / 2

export const GRID_COLUMNS = 2

/** The index an arrow key moves to. Arrows move spatially in the grid and through the list in order. */
export function moveFocus(at: number, count: number, layout: 'grid' | 'list', dir: 'up' | 'down' | 'left' | 'right'): number {
  if (layout === 'list') {
    if (dir === 'up' || dir === 'left') return Math.max(0, at - 1)
    return Math.min(count - 1, at + 1)
  }
  const step = { up: -GRID_COLUMNS, down: GRID_COLUMNS, left: -1, right: 1 }[dir]
  // Left and right stay on their row rather than wrapping onto the next one.
  if ((dir === 'left' && at % GRID_COLUMNS === 0) || (dir === 'right' && at % GRID_COLUMNS === GRID_COLUMNS - 1)) return at
  const next = at + step
  return next < 0 || next >= count ? at : next
}

function Card({ node, focused, width, active }: { node: MenuNode; focused: boolean; width: number; active: boolean }) {
  const glyphs = useGlyphs()
  const ascii = glyphs === ASCII_GLYPHS
  const accent = focused && active
  return (
    <Box
      width={width}
      borderStyle={ascii ? 'classic' : 'round'}
      {...(accent ? { borderColor: TOKENS.accent.ink.color } : { borderDimColor: true })}
      paddingX={1}
    >
      <Box width={4} flexShrink={0}>
        <Text {...TOKENS.muted.ink}>{ascii ? node.asciiIcon : node.icon}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text wrap="truncate-end">
          <Text {...TOKENS.accent.ink}>{focused ? glyphs.next : ' '}</Text> <Text {...TOKENS.accent.ink}>{node.key}</Text>{' '}
          <Text bold={focused}>{node.label}</Text>
        </Text>
        <Text {...TOKENS.muted.ink} wrap="truncate-end">
          {'  '}
          {node.description}
        </Text>
      </Box>
    </Box>
  )
}

function Row({ node, focused, active }: { node: MenuNode; focused: boolean; active: boolean }) {
  const glyphs = useGlyphs()
  return (
    <Text wrap="truncate-end">
      <Text {...TOKENS.accent.ink}>{focused ? glyphs.next : ' '}</Text> <Text {...TOKENS.accent.ink}>{node.key}</Text>{' '}
      <Text bold={focused && active}>{node.label}</Text>
      {node.children ? <Text {...TOKENS.muted.ink}> {glyphs.next}</Text> : null}
    </Text>
  )
}

export function MenuGrid({ items, focus, layout, width, active = true }: MenuGridProps) {
  if (layout === 'list') {
    return (
      <Box flexDirection="column">
        {items.map((node, i) => (
          <Row key={node.id} node={node} focused={i === focus} active={active} />
        ))}
      </Box>
    )
  }
  const card = Math.min(MAX_CARD, Math.floor((width - GAP) / GRID_COLUMNS))
  const rows: MenuNode[][] = []
  for (let i = 0; i < items.length; i += GRID_COLUMNS) rows.push(items.slice(i, i + GRID_COLUMNS))
  return (
    <Box flexDirection="column" alignItems="center" width={width}>
      {rows.map((row, r) => (
        <Box key={r} columnGap={GAP}>
          {row.map((node, c) => (
            <Card key={node.id} node={node} focused={r * GRID_COLUMNS + c === focus} width={card} active={active} />
          ))}
        </Box>
      ))}
    </Box>
  )
}
