import type { Token } from './tokens.js'

// The colours the terminal tokens become on a web page: the stats dashboard and
// the website. Kept beside tokens.ts so a token means the same thing on all
// three surfaces, and kept to plain hex strings with nothing but a type import,
// so the website's browser code and the stats page's bundle can both load it.
//
// Every value here is held to WCAG AA by test/ui/web-palette.test.ts: text
// tokens 4.5:1 on both the page and a panel, chart series 3:1 on a panel.
// Changing a value means running that test, not eyeballing it.

export interface WebSurface {
  bg: string
  fg: string
  // Cards, tables and chart backgrounds: one step off the page.
  panel: string
  // Borders and gridlines. Not text, so not held to a ratio.
  rule: string
  // Secondary text: captions, axis labels, context lines.
  muted: string
  tokens: Record<Token, string>
  // Categorical chart colours, in the order a chart should use them. Hue
  // steps first and lightness second, after Okabe and Ito, so neighbouring
  // segments stay apart for the commoner kinds of colour blindness. Charts
  // still label every segment: colour is never the only carrier.
  series: readonly string[]
}

export interface TerminalSurface {
  bg: string
  fg: string
  tokens: Record<Token, string>
}

export interface WebPalette {
  light: WebSurface
  dark: WebSurface
  // The website shows terminal output on a dark panel in both of its themes,
  // because that is what a terminal looks like. One set, then, tuned for that.
  terminal: TerminalSurface
}

const DARK_TOKENS: Record<Token, string> = {
  success: '#3fb950',
  warn: '#d29922',
  error: '#ff7b72',
  muted: '#8b949e',
  accent: '#39c5cf',
  heading: '#e6edf3',
  count: '#e6edf3',
  path: '#39c5cf',
}

export const WEB_PALETTE: WebPalette = {
  light: {
    bg: '#f6f8fa',
    fg: '#1f2328',
    panel: '#ffffff',
    rule: '#d8dee4',
    muted: '#59636e',
    tokens: {
      success: '#1a7f37',
      warn: '#9a6700',
      error: '#cf222e',
      muted: '#59636e',
      // Cyan in the terminal. A true cyan cannot pass 4.5:1 on white, so this
      // is a teal dark enough to pass that still reads as the same family.
      accent: '#0e7490',
      heading: '#1f2328',
      count: '#1f2328',
      path: '#0e7490',
    },
    series: ['#0072b2', '#c2410c', '#047857', '#b4357d', '#8a6300', '#6d28d9', '#0f766e', '#57606a'],
  },
  dark: {
    bg: '#0d1117',
    fg: '#e6edf3',
    panel: '#161b22',
    rule: '#30363d',
    muted: '#9198a1',
    tokens: DARK_TOKENS,
    series: ['#56b4e9', '#f0883e', '#3fb950', '#e78fc4', '#e3b341', '#b392f0', '#2dd4bf', '#9198a1'],
  },
  terminal: {
    bg: '#0d1117',
    fg: '#e6edf3',
    tokens: DARK_TOKENS,
  },
}

function channel(hex: string, at: number): number {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

/** The WCAG 2 contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
