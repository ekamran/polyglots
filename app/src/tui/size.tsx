import { createContext, useContext, type ReactNode } from 'react'
import { useWindowSize } from 'ink'

export interface Size {
  columns: number
  rows: number
}

// Below this the frame shows a request to enlarge the terminal instead of a
// layout that wraps into nonsense. 60 rather than the 80 first planned: two
// cards side by side fit at 80 already, so an 80-column floor would have meant
// the one-column layout could never be seen.
export const MIN_SIZE: Size = { columns: 60, rows: 20 }

// The grid is four rows of four-line cards under a four-line wordmark, which
// is exactly 24 rows with the footer. Two 38-column cards and their gap need 80.
const GRID: Size = { columns: 80, rows: 24 }

// The widest the frame grows: two 56-column home cards and the column
// between them. A wider terminal centres the frame instead of stretching it,
// so every screen shares the home grid's edges and the eye does not jump
// between a centred home and screens pinned to the far left.
export const MAX_FRAME_COLUMNS = 113

/** The size the frame lays out in: the window, capped at the frame's widest. */
export function frameSize(window: Size): Size {
  return { columns: Math.min(window.columns, MAX_FRAME_COLUMNS), rows: window.rows }
}

export interface FrameLayout {
  fits: boolean
  menu: 'grid' | 'list'
  wordmark: boolean
}

export function frameLayout(size: Size): FrameLayout {
  const fits = size.columns >= MIN_SIZE.columns && size.rows >= MIN_SIZE.rows
  const grid = size.columns >= GRID.columns && size.rows >= GRID.rows
  return { fits, menu: grid ? 'grid' : 'list', wordmark: grid }
}

const SizeContext = createContext<Size>(GRID)

// One reading of the window for the whole tree. Ink's hook re-renders on
// resize, so everything below re-lays out without asking.
export function SizeProvider({ children }: { children: ReactNode }) {
  const size = useWindowSize()
  return <SizeContext.Provider value={size}>{children}</SizeContext.Provider>
}

export function useSize(): Size {
  return useContext(SizeContext)
}
