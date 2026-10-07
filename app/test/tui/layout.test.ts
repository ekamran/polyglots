import { describe, expect, it } from 'vitest'
import { frameLayout, MIN_SIZE } from '../../src/tui/size.js'

describe('frameLayout', () => {
  it('draws the grid and the wordmark from 80x24 up', () => {
    expect(frameLayout({ columns: 80, rows: 24 })).toEqual({ fits: true, menu: 'grid', wordmark: true })
    expect(frameLayout({ columns: 120, rows: 40 })).toEqual({ fits: true, menu: 'grid', wordmark: true })
  })

  it('falls back to a one-column list between the minimum and 80 columns', () => {
    expect(frameLayout({ columns: 79, rows: 24 })).toEqual({ fits: true, menu: 'list', wordmark: false })
    expect(frameLayout({ columns: 60, rows: 20 })).toEqual({ fits: true, menu: 'list', wordmark: false })
  })

  // Eight bordered cards need four rows of four lines plus the header, so a
  // wide but short terminal gets the list too rather than a clipped grid.
  it('uses the list on a wide terminal that is too short for the grid', () => {
    expect(frameLayout({ columns: 120, rows: 22 })).toEqual({ fits: true, menu: 'list', wordmark: false })
  })

  it('does not fit below 60x20', () => {
    expect(MIN_SIZE).toEqual({ columns: 60, rows: 20 })
    expect(frameLayout({ columns: 59, rows: 30 }).fits).toBe(false)
    expect(frameLayout({ columns: 100, rows: 19 }).fits).toBe(false)
  })
})
