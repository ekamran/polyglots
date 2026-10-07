import { describe, expect, it } from 'vitest'
import { cutRelease } from '../../scripts/release-changelog.mjs'

const HEAD = '# Changelog\n\nIntro.\n\n'

describe('cutRelease', () => {
  it('moves the Unreleased entries under a dated heading and leaves Unreleased empty', () => {
    const before = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- A thing.\n\n## [0.25.0] - 2026-10-07\n\n- Old.\n`
    const { changelog, notes } = cutRelease(before, '0.26.0', '2026-10-09')
    expect(changelog).toBe(
      `${HEAD}## [Unreleased]\n\n## [0.26.0] - 2026-10-09\n\n### Fixed\n\n- A thing.\n\n## [0.25.0] - 2026-10-07\n\n- Old.\n`,
    )
    expect(notes).toBe('### Fixed\n\n- A thing.')
  })

  // A release with nothing under Unreleased is a version number with no
  // account of what it changed, which is the one thing the changelog is for.
  it('refuses when Unreleased is empty', () => {
    expect(() => cutRelease(`${HEAD}## [Unreleased]\n\n## [0.25.0] - 2026-10-07\n`, '0.26.0', '2026-10-09')).toThrow(/Unreleased is empty/)
  })

  it('refuses when there is no Unreleased heading', () => {
    expect(() => cutRelease(`${HEAD}## [0.25.0] - 2026-10-07\n`, '0.26.0', '2026-10-09')).toThrow(/no ## \[Unreleased\]/)
  })

  it('works when Unreleased is the only section', () => {
    const { changelog } = cutRelease(`${HEAD}## [Unreleased]\n\n- First.\n`, '0.1.0', '2026-10-09')
    expect(changelog).toBe(`${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-10-09\n\n- First.\n`)
  })
})
