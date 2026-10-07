import { createContext, useContext } from 'react'
import { ASCII_GLYPHS, UNICODE_GLYPHS, type GlyphSet } from '../ui/glyphs.js'
import { asciiOnly } from '../ui/paint.js'

// The CLI's glyph set, decided by the same environment check, so a terminal
// that gets plus signs from `polyglots review` gets them here too. A context
// rather than a module constant so a test can render the ASCII frame without
// touching process.env.
const GlyphContext = createContext<GlyphSet>(asciiOnly(process.env) ? ASCII_GLYPHS : UNICODE_GLYPHS)

export const GlyphProvider = GlyphContext.Provider

export function useGlyphs(): GlyphSet {
  return useContext(GlyphContext)
}
