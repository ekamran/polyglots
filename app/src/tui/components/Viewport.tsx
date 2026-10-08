import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink'
import { TOKENS } from '../../ui/tokens.js'

// The frame's body, scrolled rather than clipped. A screen taller than the
// room between the header and the footer used to lose its bottom rows: at
// 80x24 the built-in rules list put its last rules, the detail of the rule in
// focus and the key hint below the footer, so moving the cursor down walked it
// out of sight with nothing on screen to say where it had gone.
//
// Scrolling follows focus rather than keys. Every tall screen here is tall
// because of a list or a form with a cursor, and the cursor is where the
// reader is looking; a separate scroll key would leave two positions to keep
// in step, and a keypress to reach the row the arrow keys already moved to.
// A screen marks its cursor row with ScrollTarget and the body keeps that row
// in view. A screen that marks nothing has no cursor to follow (Agents on a
// small terminal, a review summary), so page up and page down move its body a
// page at a time, and the count of rows out of sight on the last line says
// there is more.
//
// Measured from Ink's own layout after each commit. Yoga has computed the
// layout by the time layout effects run, so the offset is decided against the
// frame that is about to be drawn, not the one before it.

interface Follow {
  follow(el: DOMElement | null): void
  release(el: DOMElement | null): void
}

const ScrollContext = createContext<Follow | undefined>(undefined)

/** Marks the rows the body should keep in view while `active`. */
export function ScrollTarget({ active, children }: { active: boolean; children: ReactNode }) {
  const scroll = useContext(ScrollContext)
  const ref = useRef<DOMElement>(null)
  // Every render, not only on mount: the row moves when the rows above it
  // change, and that is the moment the offset has to move with it.
  useLayoutEffect(() => {
    if (active) scroll?.follow(ref.current)
  })
  useLayoutEffect(() => {
    const el = ref.current
    return () => scroll?.release(el)
  }, [scroll])
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      {children}
    </Box>
  )
}

const heightOf = (el: DOMElement | null): number => el?.yogaNode?.getComputedHeight() ?? 0

// The target's top relative to the scrolled content, summed up the tree,
// since Yoga gives each node's position relative to its own parent only.
function topWithin(el: DOMElement, root: DOMElement): number | undefined {
  let top = 0
  for (let node: DOMElement | undefined = el; node !== root; node = node.parentNode) {
    if (!node?.yogaNode) return undefined
    top += node.yogaNode.getComputedTop()
  }
  return top
}

/** Moves the body by pages; set by the Viewport for the frame's page keys. */
export type PageBy = (pages: number) => void

export function Viewport({ children, pageRef }: { children: ReactNode; pageRef?: { current: PageBy | undefined } }) {
  const outerRef = useRef<DOMElement>(null)
  const contentRef = useRef<DOMElement>(null)
  const target = useRef<DOMElement | null>(null)
  const [offset, setOffset] = useState(0)
  // Read only so a resize or a screen growing re-renders the body and so
  // re-runs the layout effect below; the values themselves come from Yoga.
  useBoxMetrics(outerRef)
  const content = useBoxMetrics(contentRef)

  const recompute = useCallback(() => {
    const full = heightOf(outerRef.current)
    const contentRoot = contentRef.current
    // Hidden under an overlay or the too-small notice, the body lays out at
    // no height. Keeping the offset there means the row in focus is still
    // in view when the screen comes back.
    if (full === 0 || !contentRoot) return
    const height = heightOf(contentRoot)
    if (height <= full) return setOffset(0)
    // The marker line comes out of the room. Decided against the full height
    // rather than the clip's own, which shrinks once the marker is shown: a
    // screen exactly as tall as the body would otherwise keep a marker it no
    // longer needs after shrinking back to fit.
    const room = full - 1
    setOffset((current) => {
      let next = Math.min(Math.max(0, current), height - room)
      const el = target.current
      const top = el ? topWithin(el, contentRoot) : undefined
      if (el && top !== undefined) {
        const rows = heightOf(el)
        // A row that fits in the screen's first page shows the first page,
        // so going back up the list brings the title and the lines that
        // explain it back too, instead of leaving them cut off above a cursor
        // that is in view. Past the first page the offset moves as little as
        // keeps the row in view.
        if (top + rows <= room) next = 0
        else if (top < next) next = top
        else if (top + rows > next + room) next = top + rows - room
      }
      return next
    })
  }, [])

  const follow = useMemo<Follow>(
    () => ({
      follow: (el) => {
        target.current = el
        recompute()
      },
      release: (el) => {
        if (target.current === el) target.current = null
      },
    }),
    [recompute],
  )

  useLayoutEffect(recompute)

  // Only where no row is followed: with a cursor on screen, the cursor is
  // what moves the body, and a page key would be undone on the next render.
  if (pageRef) {
    pageRef.current = (pages) => {
      if (target.current) return
      const full = heightOf(outerRef.current)
      const height = heightOf(contentRef.current)
      if (full === 0 || height <= full) return
      const room = full - 1
      setOffset((current) => Math.min(Math.max(0, current + pages * Math.max(1, room - 1)), height - room))
    }
  }

  const full = heightOf(outerRef.current)
  const overflow = full > 0 && content.height > full
  const room = overflow ? full - 1 : full
  const above = overflow ? offset : 0
  const below = overflow ? Math.max(0, content.height - offset - room) : 0

  return (
    <ScrollContext.Provider value={follow}>
      <Box ref={outerRef} flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {/* Not shrinkable: a screen taller than the body is scrolled,
              where Ink would otherwise squeeze its lines into each other. */}
          <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-above}>
            {children}
          </Box>
        </Box>
        {overflow && (
          <Text {...TOKENS.muted.ink} wrap="truncate">
            {[above > 0 ? `↑ ${above} more above` : '', below > 0 ? `↓ ${below} more below` : ''].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Box>
    </ScrollContext.Provider>
  )
}
