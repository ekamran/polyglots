import { stripVTControlCharacters } from 'node:util'
import sliceAnsi from 'slice-ansi'
import stringWidth from 'string-width'
import type { Painter } from './paint.js'

// Measured by grapheme cluster with string-width, the measure Ink uses, so the
// CLI and the TUI agree on how wide a line is. The hand-rolled table this
// replaced summed code points against a list of wide ranges, which got a ZWJ
// family as three emoji wide, added a skin tone modifier as two more columns,
// and counted emoji outside its ranges (a check mark button, a sun with a
// variation selector) as one. Each of those shifted a box's right border.
// Escape codes are stripped first with node's own function, which also knows
// OSC 8 hyperlinks.

/** Columns a string takes on a terminal, escape codes excluded. */
export function displayWidth(text: string): number {
  return stringWidth(stripVTControlCharacters(text))
}

export function padTo(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = ' '.repeat(Math.max(0, width - displayWidth(text)))
  return align === 'right' ? gap + text : text + gap
}

// Cut by columns with slice-ansi, which keeps the escape codes of the part
// that survives and closes any it cuts through, so a truncated cell stays the
// colour it was instead of falling back to plain text. It also never splits a
// grapheme cluster: a family emoji is kept whole or dropped whole.
//
// The result is never wider than asked for. An ellipsis that does not fit (the
// ASCII "..." in two columns) is itself cut down, rather than returned whole
// and pushing the line past the edge it was cut to fit.
export function truncate(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text
  const mark = displayWidth(ellipsis) <= width ? ellipsis : sliceAnsi(ellipsis, 0, width)
  return sliceAnsi(text, 0, width - displayWidth(mark)) + mark
}

export interface TableOptions {
  align?: Array<'left' | 'right'>
  gap?: number
  indent?: number
}

export function table(rows: string[][], opts: TableOptions = {}): string[] {
  const gap = ' '.repeat(opts.gap ?? 2)
  const indent = ' '.repeat(opts.indent ?? 0)
  const columns = Math.max(0, ...rows.map((r) => r.length))
  const widths = Array.from({ length: columns }, (_, c) => Math.max(0, ...rows.map((r) => displayWidth(r[c] ?? ''))))
  return rows.map((row) => {
    const cells = row.map((cell, c) => {
      const align = opts.align?.[c] ?? 'left'
      // The last column is left ragged unless it is right-aligned, so a short
      // final cell does not drag trailing spaces onto every line.
      if (c === row.length - 1 && align === 'left') return cell
      return padTo(cell, widths[c]!, align)
    })
    return (indent + cells.join(gap)).replace(/ +$/, '')
  })
}

// Below this many columns inside the frame, the frame costs more than it
// shows: at eight columns wide a box holds two characters of each line and
// six of border. The lines are then printed bare, each cut to the terminal,
// so the numbers stay readable instead of every cell becoming an ellipsis.
const MIN_FRAMED_INNER = 8

export function box(p: Painter, title: string, lines: string[]): string[] {
  const { tl, tr, bl, br, h, v } = p.glyphs.box
  // Two spaces of padding inside each side, one border column each side.
  const maxInner = p.width - 6
  if (maxInner < MIN_FRAMED_INNER) return [title, ...lines].map((l) => truncate(l, p.width, p.glyphs.ellipsis))
  const body = lines.map((l) => truncate(l, maxInner, p.glyphs.ellipsis))
  const titleText = truncate(title, maxInner, p.glyphs.ellipsis)
  const inner = Math.min(maxInner, Math.max(displayWidth(titleText) + 2, ...body.map((l) => displayWidth(l))))
  const span = inner + 4
  const top = `${tl}${h} ${titleText} ${h.repeat(Math.max(0, span - displayWidth(titleText) - 3))}${tr}`
  return [
    top,
    ...body.map((l) => `${v}  ${padTo(l, inner)}  ${v}`),
    `${bl}${h.repeat(span)}${br}`,
  ]
}

export function sparkline(values: number[], glyphs: readonly string[]): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const top = glyphs.length - 1
  return values.map((v) => glyphs[max === min ? 0 : Math.round(((v - min) / (max - min)) * top)]).join('')
}
