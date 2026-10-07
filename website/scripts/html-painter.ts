import { UNICODE_GLYPHS } from '../../app/src/ui/glyphs.js'
import type { Painter } from '../../app/src/ui/paint.js'
import type { Token } from '../../app/src/ui/tokens.js'

// A Painter whose colour survives into HTML as the token's name, not as an
// ANSI colour that would then have to be parsed back into a guess at intent.
//
// Each painted run is wrapped in an OSC 8 sequence (the terminal hyperlink
// escape) carrying `pg:<token>`. That choice is load-bearing: layout.ts
// measures every cell with stripVTControlCharacters, which strips OSC as well
// as SGR, so box padding and table columns come out exactly as they do on a
// real terminal. A marker the width maths could see, such as a literal
// `<span>`, would pad every coloured cell short by the length of its tag.
const OPEN = (token: Token) => `\x1b]8;;pg:${token}\x07`
const CLOSE = '\x1b]8;;\x07'

export function htmlPainter(width = 80): Painter {
  return {
    color: true,
    glyphs: UNICODE_GLYPHS,
    width,
    paint: (token, text) => `${OPEN(token)}${text}${CLOSE}`,
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One pass over the line: markers become spans, text is escaped, and any other
// escape sequence is dropped. A stray SGR from a code path that bypassed the
// painter must not reach the page as literal `[32m`, and must not be trusted
// as markup either.
const SEQUENCE = /\x1b\]8;;(?:pg:([a-z]+))?\x07|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

export function lineToHtml(line: string): string {
  let out = ''
  let open = 0
  let last = 0
  for (const m of line.matchAll(SEQUENCE)) {
    out += escapeHtml(line.slice(last, m.index))
    last = m.index + m[0].length
    if (m[0].startsWith('\x1b]8;;pg:')) {
      out += `<span class="t-${m[1]}">`
      open++
    } else if (m[0] === CLOSE && open > 0) {
      out += '</span>'
      open--
    }
  }
  out += escapeHtml(line.slice(last))
  // A line cut through a marker by truncate() would otherwise leave the page's
  // markup unbalanced for every line after it.
  return out + '</span>'.repeat(open)
}

/** The visible text of a painted line, for the plain-text copy beside each panel. */
export function lineToText(line: string): string {
  return line.replace(SEQUENCE, '')
}

// What a terminal shows after a run of writes, for a reporter that redraws its
// line in place with \r and erase-line. Only the sequences the progress
// reporters emit are understood; anything else is kept as text and stripped
// later by lineToHtml.
const CLEAR_LINE = '\r\x1b[2K'

export class Screen {
  readonly lines: string[] = ['']

  write(chunk: string): boolean {
    for (const [i, part] of chunk.split(CLEAR_LINE).entries()) {
      if (i > 0) this.lines[this.lines.length - 1] = ''
      const rows = part.split('\n')
      rows.forEach((row, r) => {
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
