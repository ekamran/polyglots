import { describe, expect, it } from 'vitest'
import { buildReport, groupFor, OTHER_GROUP, REPORT_GROUPS, roundCount } from '../../src/review/message.js'

describe('groupFor', () => {
  it('folds a rule and the model category that means the same thing together', () => {
    expect(groupFor('glossary')).toBe('glossary')
    expect(groupFor('ai:glossary')).toBe('glossary')
    expect(groupFor('title-case')).toBe('title-case')
    expect(groupFor('ai:title-case')).toBe('title-case')
  })

  // Register is a judgement about wording, the same kind of finding a human
  // would describe as meaning or fluency, so it is not filed under other.
  it('counts register alongside meaning and fluency', () => {
    expect(groupFor('ai:meaning')).toBe('meaning')
    expect(groupFor('ai:fluency')).toBe('meaning')
    expect(groupFor('ai:register')).toBe('meaning')
  })

  it('sends every mechanical and residual rule to other', () => {
    for (const rule of [
      'apostrophe',
      'ai:other',
      'punctuation',
      'placeholder',
      'ai:placeholder',
      'html',
      'whitespace',
      'plural-count',
      'untranslated',
      'inconsistent',
    ]) {
      expect(groupFor(rule)).toBe(OTHER_GROUP)
    }
  })

  // A rule added later must not silently vanish from the breakdown; other is a
  // catch-all on purpose.
  it('sends an unknown rule to other rather than dropping it', () => {
    expect(groupFor('something-invented-next-year')).toBe(OTHER_GROUP)
  })

  it('names every group the report can print', () => {
    expect(REPORT_GROUPS.map((g) => g.key)).toEqual(['glossary', 'meaning', 'title-case'])
  })
})

describe('roundCount', () => {
  it('rounds to the nearest five once there is something to round', () => {
    expect(roundCount(24)).toBe('~25')
    expect(roundCount(11)).toBe('~10')
    expect(roundCount(6)).toBe('~5')
    expect(roundCount(8)).toBe('~10')
  })

  // A group can be nearly all of the run, and rounding it up would claim more
  // fixes of one kind than there were fixes at all.
  it('rounds down rather than past the total already claimed', () => {
    expect(roundCount(24, 24)).toBe('~20')
    expect(roundCount(37, 37)).toBe('~35')
    expect(roundCount(24, 37)).toBe('~25')
  })

  // Rounding a two to the nearest five reports zero of something that happened.
  it('prints a small count exactly, with no tilde', () => {
    expect(roundCount(4)).toBe('4')
    expect(roundCount(2)).toBe('2')
    expect(roundCount(1)).toBe('1')
  })
})

describe('buildReport', () => {
  it('writes the whole sentence for a run with every group', () => {
    expect(buildReport({ repaired: 37, byGroup: { glossary: 24, meaning: 11, 'title-case': 6, other: 5 } })).toBe(
      'I fixed 37 entries, which you can see <a href="">here</a>. They included ~25 glossary inconsistencies, ' +
        '~10 meaning and fluency problems and ~5 title-case issues, plus a few smaller ones.',
    )
  })

  it('drops the trailing clause when nothing fell outside the named groups', () => {
    expect(buildReport({ repaired: 30, byGroup: { glossary: 24, meaning: 11 } })).toBe(
      'I fixed 30 entries, which you can see <a href="">here</a>. They included ~25 glossary inconsistencies ' +
        'and ~10 meaning and fluency problems.',
    )
  })

  it('needs no conjunction for a single group', () => {
    expect(buildReport({ repaired: 24, byGroup: { glossary: 24 } })).toBe(
      'I fixed 24 entries, which you can see <a href="">here</a>. They included ~20 glossary inconsistencies.',
    )
  })

  // The noun agrees with the real count, not the rounded one: a group of one is
  // printed as 1, so "1 glossary inconsistencies" would be visibly wrong.
  it('uses the singular noun for a group of one', () => {
    expect(buildReport({ repaired: 1, byGroup: { glossary: 1 } })).toBe(
      'I fixed 1 entry, which you can see <a href="">here</a>. They included 1 glossary inconsistency.',
    )
  })

  it('says only that the rest were small when no named group fired', () => {
    expect(buildReport({ repaired: 5, byGroup: { other: 5 } })).toBe(
      'I fixed 5 entries, which you can see <a href="">here</a>. They were a mix of smaller issues.',
    )
  })

  it('states the count alone when nothing was categorised', () => {
    expect(buildReport({ repaired: 3, byGroup: {} })).toBe(
      'I fixed 3 entries, which you can see <a href="">here</a>.',
    )
  })

  // Nothing repaired means there is nothing to tell the requester, and an empty
  // or zero-valued sentence on the results screen would only invite posting it.
  it('returns undefined when nothing was repaired', () => {
    expect(buildReport({ repaired: 0, byGroup: {} })).toBeUndefined()
    expect(buildReport({ repaired: 0, byGroup: { glossary: 4 } })).toBeUndefined()
  })

  it('leaves the href empty so the link can be pasted in', () => {
    const report = buildReport({ repaired: 2, byGroup: { glossary: 2 } }) ?? ''
    expect(report).toContain('<a href="">here</a>')
  })
})
