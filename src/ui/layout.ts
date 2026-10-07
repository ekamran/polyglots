import { stripVTControlCharacters } from 'node:util'
import type { Painter } from './paint.js'

// Marks (combining accents), zero-width joiners and variation selectors take
// no column of their own: a decomposed "é" is one column, not two.
const ZERO_WIDTH = /[\p{Mark}\u200B-\u200D\uFE0E\uFE0F]/u

// East Asian Wide and Fullwidth ranges plus the emoji blocks. Not the whole
// Unicode table, which would be a dependency's worth of data, but every range
// a WordPress project name or file path is realistically going to contain.
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

function charWidth(ch: string): number {
  if (ZERO_WIDTH.test(ch)) return 0
  const cp = ch.codePointAt(0)!
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  return isWide(cp) ? 2 : 1
}

/** Columns a string takes on a terminal, escape codes excluded. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of stripVTControlCharacters(text)) width += charWidth(ch)
  return width
}

export function padTo(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = ' '.repeat(Math.max(0, width - displayWidth(text)))
  return align === 'right' ? gap + text : text + gap
}

// Cutting through an escape sequence would leave the terminal coloured for
// the rest of the output, so a line that must be cut loses its colour. That
// only happens on a terminal too narrow for the line, where legibility of the
// characters matters more than their colour.
export function truncate(text: string, width: number, ellipsis = '…'): string {
  if (displayWidth(text) <= width) return text
  const room = width - displayWidth(ellipsis)
  let out = ''
  let used = 0
  for (const ch of stripVTControlCharacters(text)) {
    const w = charWidth(ch)
    if (used + w > room) break
    out += ch
    used += w
  }
  return out + ellipsis
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

export function box(p: Painter, title: string, lines: string[]): string[] {
  const { tl, tr, bl, br, h, v } = p.glyphs.box
  // Two spaces of padding inside each side, one border column each side.
  const maxInner = Math.max(1, p.width - 6)
  const body = lines.map((l) => truncate(l, maxInner, p.glyphs.ellipsis))
  const titleText = truncate(title, Math.max(1, p.width - 6), p.glyphs.ellipsis)
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
