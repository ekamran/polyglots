import { inspect } from 'node:util'
import { TOKENS, type Token } from '../../app/src/ui/tokens.js'

// Terminal output, as the CLI really writes it, turned into HTML whose classes
// name the CLI's own colour tokens.
//
// The demos run the real commands, whose painter is built inside cli.ts from
// the stream it writes to, so what arrives here is styleText's ANSI. Rather
// than map ANSI colours to page colours by hand, the map is read back out of
// TOKENS: green means `success` on the page because tokens.ts says success is
// green. A token whose colour changes there changes here with it, and a colour
// no token uses is dropped instead of guessed at.

type Format = string | readonly string[]
const formats = (f: Format): readonly string[] => (typeof f === 'string' ? [f] : f)

// SGR open code to the name inspect.colors gives it ("32" -> "green").
const codeName = new Map<number, string>()
for (const [name, [open]] of Object.entries(inspect.colors as Record<string, [number, number]>)) {
  if (open !== undefined && !codeName.has(open)) codeName.set(open, name)
}

// Colour name to the first token that paints with it. bold and underline are
// attributes, not colours, and become classes of their own.
const ATTRIBUTES = new Set(['bold', 'underline'])
const colourToken = new Map<string, Token>()
for (const [token, style] of Object.entries(TOKENS) as Array<[Token, (typeof TOKENS)[Token]]>) {
  for (const name of formats(style.cli as Format)) {
    if (!ATTRIBUTES.has(name) && !colourToken.has(name)) colourToken.set(name, token)
  }
}
// gray and grey are one colour under two names in inspect.colors.
if (colourToken.has('gray')) colourToken.set('grey', colourToken.get('gray')!)

// The TUI paints through Ink, from each token's `ink` side, and there muted
// is dimColor, not gray. So dim on its own is whichever token Ink dims with,
// read from TOKENS like the colours are. Dim over a colour is that colour,
// faded, which is what a terminal shows.
const dimToken = (Object.entries(TOKENS) as Array<[Token, (typeof TOKENS)[Token]]>).find(([, s]) => s.ink.dimColor === true)?.[0]

interface Style {
  fg?: Token
  bold: boolean
  dim: boolean
  underline: boolean
  inverse: boolean
}

const PLAIN: Style = { bold: false, dim: false, underline: false, inverse: false }

function apply(style: Style, params: number[]): Style {
  const next = { ...style }
  for (const code of params.length === 0 ? [0] : params) {
    if (code === 0) return { ...PLAIN }
    if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    // One code ends both, in every terminal: bold and faint are two ends of
    // the same intensity setting.
    else if (code === 22) {
      next.bold = false
      next.dim = false
    } else if (code === 4) next.underline = true
    else if (code === 24) next.underline = false
    else if (code === 7) next.inverse = true
    else if (code === 27) next.inverse = false
    else if (code === 39) delete next.fg
    else {
      const name = codeName.get(code)
      const token = name ? colourToken.get(name) : undefined
      if (token) next.fg = token
    }
  }
  return next
}

const classes = (s: Style): string => {
  const fg = s.fg ?? (s.dim ? dimToken : undefined)
  return [
    fg ? `t-${fg}` : '',
    s.dim && s.fg ? 't-dim' : '',
    s.bold ? 't-bold' : '',
    s.underline ? 't-underline' : '',
    s.inverse ? 't-inverse' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// SGR is captured; every other CSI and OSC sequence is matched only so it can
// be dropped. A sequence shown as literal text would read as a bug on the page.
const SEQUENCE = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function ansiToHtml(line: string): string {
  let out = ''
  let style: Style = { ...PLAIN }
  let last = 0
  const text = (s: string) => {
    if (!s) return
    const cls = classes(style)
    out += cls ? `<span class="${cls}">${escapeHtml(s)}</span>` : escapeHtml(s)
  }
  for (const m of line.matchAll(SEQUENCE)) {
    text(line.slice(last, m.index))
    last = m.index + m[0].length
    if (m[1] !== undefined) style = apply(style, m[1] === '' ? [] : m[1].split(';').map(Number))
  }
  text(line.slice(last))
  return out
}

/** The visible text of a line, for the plain copy beside each panel. */
export function ansiToText(line: string): string {
  return line.replace(SEQUENCE, '')
}

// What a terminal shows after a run of writes. The progress reporters redraw
// their line in place with \r and erase-line, and that is the only cursor
// movement they use, so it is the only one understood here.
const CLEAR_LINE = '\r\x1b[2K'

export class Screen {
  readonly lines: string[] = ['']

  write(chunk: string): boolean {
    for (const [i, part] of chunk.split(CLEAR_LINE).entries()) {
      if (i > 0) this.lines[this.lines.length - 1] = ''
      part.split('\n').forEach((row, r) => {
        if (r > 0) this.lines.push('')
        this.lines[this.lines.length - 1] += row
      })
    }
    return true
  }

  /** The screen as it stands, without the empty line the cursor sits on. */
  frame(): string[] {
    const out = [...this.lines]
    if (out.at(-1) === '') out.pop()
    return out
  }
}
