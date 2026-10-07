import { describe, expect, it } from 'vitest'
import { buildReport, groupFor, OTHER_GROUP, REPORT_GROUPS, roundCount, translationsUrl } from '../../src/review/message.js'

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

/**
 * The link used to be left empty on the reasoning that only the reviewer knows
 * which page they mean. They do, but so does the run: GlotPress names its own
 * exports after the project path, so the file already carries the project, the
 * branch and the locale, and the reviewer's own wp.org login is a standing
 * setting rather than a per-run choice. The one real URL this was checked
 * against is the netro-ads case below, copied from the browser.
 */
describe('translationsUrl', () => {
  const EXPECTED =
    'https://translate.wordpress.org/projects/wp-plugins/netro-ads/dev/tr/default/' +
    '?filters[translated]=yes&filters[status]=current_or_waiting_or_fuzzy_or_untranslated&filters[user_login]=emre'

  it('rebuilds the page a reviewer would have opened by hand', () => {
    expect(translationsUrl('/Users/x/Downloads/wp-plugins-netro-ads-dev-tr.po', 'tr', 'emre')).toBe(EXPECTED)
  })

  it('keeps the branch the export was taken from', () => {
    expect(translationsUrl('wp-plugins-bit-pi-stable-tr.po', 'tr', 'emre')).toContain('/bit-pi/stable/tr/default/')
  })

  // A slug with a hyphen in it is the normal case, not the exception.
  it('does not mistake a hyphen in the slug for a boundary', () => {
    expect(translationsUrl('wp-plugins-stocktake-for-woocommerce-dev-tr.po', 'tr', 'emre')).toContain(
      '/stocktake-for-woocommerce/dev/tr/',
    )
  })

  // A theme export carries no branch, and its slug cannot be told from the
  // locale by shape alone: twenty-twenty-four-pt-br could split either way.
  // Knowing the run's locale is what makes it unambiguous.
  it('handles a theme, which has no branch', () => {
    expect(translationsUrl('wp-themes-twenty-twenty-four-tr.po', 'tr', 'emre')).toContain(
      '/projects/wp-themes/twenty-twenty-four/tr/default/',
    )
  })

  // Both are this tool's own doing: review writes -repaired, split writes the
  // numbered parts. Neither is part of the project's name.
  it('sees past the suffixes this tool adds itself', () => {
    expect(translationsUrl('wp-plugins-netro-ads-dev-tr-repaired.po', 'tr', 'emre')).toBe(EXPECTED)
    expect(translationsUrl('wp-plugins-netro-ads-dev-tr-01.po', 'tr', 'emre')).toBe(EXPECTED)
    expect(translationsUrl('wp-plugins-netro-ads-dev-tr-part-31.po', 'tr', 'emre')).toBe(EXPECTED)
  })

  /**
   * A core project is neither a plugin nor a theme and does not follow their
   * shape, so it is a named path rather than a parse. Checked against the real
   * page: translate.wordpress.org/projects/patterns/core/tr/default/.
   */
  it('knows the core projects it has been shown', () => {
    expect(translationsUrl('patterns-core-tr.po', 'tr', 'emre')).toBe(
      'https://translate.wordpress.org/projects/patterns/core/tr/default/' +
        '?filters[translated]=yes&filters[status]=current_or_waiting_or_fuzzy_or_untranslated&filters[user_login]=emre',
    )
  })

  // Guessing a URL into a message bound for a public forum is the one thing
  // this must not do, so anything it cannot read gets no link at all.
  it('declines rather than guesses', () => {
    expect(translationsUrl('wp-plugins-netro-ads-dev-tr.po', 'tr', '')).toBeUndefined()
    // A core project nobody has shown it the page for. Inventing wp/dev from
    // the shape of patterns-core is exactly the guess this must not make.
    expect(translationsUrl('wp-dev-tr.po', 'tr', 'emre')).toBeUndefined()
    expect(translationsUrl('some-export.po', 'tr', 'emre')).toBeUndefined()
    // The locale the run used has to be the one the file names, or the name
    // has not been understood and neither has the slug.
    expect(translationsUrl('wp-plugins-netro-ads-dev-tr.po', 'de', 'emre')).toBeUndefined()
  })
})

describe('buildReport with a link it can build', () => {
  const summary = { repaired: 24, byGroup: { glossary: 24 }, file: 'wp-plugins-netro-ads-dev-tr.po', locale: 'tr' }

  it('points the link at the reviewer own translations', () => {
    expect(buildReport(summary, 'emre')).toContain('href="https://translate.wordpress.org/projects/wp-plugins/netro-ads/dev/tr/default/')
    expect(buildReport(summary, 'emre')).toContain('filters[user_login]=emre')
  })

  // Unchanged from before there was a URL to build: the sentence still stands
  // and the reviewer pastes a link in by hand, as they always have.
  it('leaves the href empty when it cannot be built', () => {
    expect(buildReport({ ...summary, file: 'mystery.po' }, 'emre')).toContain('<a href="">here</a>')
    expect(buildReport(summary, '')).toContain('<a href="">here</a>')
  })
})
