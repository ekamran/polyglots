import { displayWidth } from './layout.js'

// The name drawn in quadrant blocks, four rows tall. Shared rather than kept
// in the TUI because the website renders the same one, and a copy there would
// drift the first time either was touched.
//
// Quadrant blocks are outside what ASCII_GLYPHS can stand in for, so a surface
// in ASCII mode shows WORDMARK_PLAIN instead of a degraded drawing.
export const WORDMARK: readonly string[] = [
  '    ▜     ▜   ▗',
  '▛▌▛▌▐ ▌▌▛▌▐ ▛▌▜▘▛▘',
  '▙▌▙▌▐▖▙▌▙▌▐▖▙▌▐▖▄▌',
  '▌     ▄▌▄▌',
]

export const WORDMARK_PLAIN = 'polyglots'

export const wordmarkWidth: number = Math.max(...WORDMARK.map(displayWidth))
