import type { Painter } from './paint.js'
import { table } from './layout.js'

// Colour goes on the glyph, never the sentence. A red paragraph is hard to read
// on half the terminal themes in use, and the glyph alone is enough to find
// the line when scanning back through scrollback.
export const okLine = (p: Painter, msg: string): string => `${p.paint('success', p.glyphs.ok)} ${msg}`
export const errorLine = (p: Painter, msg: string): string => `${p.paint('error', p.glyphs.fail)} ${msg}`
export const warnLine = (p: Painter, msg: string): string => `${p.paint('warn', p.glyphs.warn)} ${msg}`
export const nextLine = (p: Painter, msg: string): string => `${p.paint('accent', p.glyphs.next)} ${msg}`
export const hintLine = (p: Painter, msg: string): string => `  ${p.paint('muted', msg)}`

export function header(p: Painter, command: string, subject: string, facts: Array<[string, string]>): string[] {
  return [
    `${p.paint('heading', `polyglots ${command}`)}  ${subject}`,
    ...table(facts.map(([k, v]) => [p.paint('muted', k), v]), { indent: 2 }),
  ]
}
