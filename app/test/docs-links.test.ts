import { describe, expect, it } from 'vitest'
import { LOCAL_REVIEW_NOTICE, localBatchAdvice } from '../src/review/local.js'
import { docsUrl } from '../src/docs-links.js'

// A message that sends someone to read more has to name a place an installed
// copy can reach. docs/ paths only exist in a repo checkout.
describe('documentation links in messages', () => {
  it('builds website URLs', () => {
    expect(docsUrl('local-models')).toBe('https://ada.tools/polyglots/docs/local-models/')
  })

  it('points the local-review notice and batch advice at the website', () => {
    expect(LOCAL_REVIEW_NOTICE).toContain(docsUrl('local-models'))
    expect(LOCAL_REVIEW_NOTICE).not.toContain('docs/local-models.md')
    const advice = localBatchAdvice({ batchSize: 100, locale: 'tr', model: 'local:x', kind: 'openai-compatible' })
    expect(advice).toContain(docsUrl('local-models'))
  })
})
