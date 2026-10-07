// The changelog half of a release, kept apart from release.mjs so it can be
// tested without running git or npm.
//
// Entries are written under ## [Unreleased] when work is merged, by whoever
// merges it. A release only moves them under a dated version heading, so the
// release itself makes no judgement about what changed; it records it.

const UNRELEASED = '## [Unreleased]'

/**
 * @param {string} text the whole CHANGELOG.md
 * @param {string} version for example 0.26.0
 * @param {string} date YYYY-MM-DD
 * @returns {{ changelog: string, notes: string }}
 */
export function cutRelease(text, version, date) {
  const start = text.indexOf(UNRELEASED)
  if (start === -1) throw new Error('CHANGELOG.md has no ## [Unreleased] heading.')
  const bodyStart = start + UNRELEASED.length
  const next = text.indexOf('\n## [', bodyStart)
  const bodyEnd = next === -1 ? text.length : next + 1
  const notes = text.slice(bodyStart, bodyEnd).trim()
  if (notes === '') {
    throw new Error('Unreleased is empty. Write what changed under ## [Unreleased] in CHANGELOG.md, then release.')
  }
  const tail = text.slice(bodyEnd)
  const changelog = `${text.slice(0, start)}${UNRELEASED}\n\n## [${version}] - ${date}\n\n${notes}\n${tail === '' ? '' : `\n${tail}`}`
  return { changelog, notes }
}
