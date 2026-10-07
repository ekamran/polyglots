import type { styleText } from 'node:util'

type StyleFormat = Parameters<typeof styleText>[0]

// Named for what they mean, not how they look, so a command says "this is a
// warning" and the palette is decided once. The Ink side is here too, unused
// until the TUI facelift (#14), so the two surfaces cannot drift apart.
export type Token = 'success' | 'warn' | 'error' | 'muted' | 'accent' | 'heading' | 'count' | 'path'

export interface TokenStyle {
  cli: StyleFormat
  ink: { color?: string; bold?: boolean; dimColor?: boolean; underline?: boolean }
}

export const TOKENS: Record<Token, TokenStyle> = {
  success: { cli: 'green', ink: { color: 'green' } },
  warn: { cli: 'yellow', ink: { color: 'yellow' } },
  error: { cli: 'red', ink: { color: 'red' } },
  muted: { cli: 'gray', ink: { dimColor: true } },
  accent: { cli: 'cyan', ink: { color: 'cyan' } },
  heading: { cli: 'bold', ink: { bold: true } },
  count: { cli: 'bold', ink: { bold: true } },
  path: { cli: ['cyan', 'underline'], ink: { color: 'cyan', underline: true } },
}
