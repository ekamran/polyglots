import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { approx, loadUsageTotals, parseUsageTotals } from '../src/lib/usage.js'

const good = {
  generatedAt: '2026-10-08T12:00:00.000Z',
  installs: 12,
  reviewed: 184230,
  drafted: 20411,
  repaired: 3120,
  projects: 412,
  findings: { glossary: 1830 },
}

test('a well-formed file gives the totals the page shows', () => {
  assert.deepEqual(parseUsageTotals(good), { installs: 12, reviewed: 184230, drafted: 20411, repaired: 3120 })
})

test('anything short of that shows nothing', () => {
  assert.equal(parseUsageTotals(null), undefined)
  assert.equal(parseUsageTotals('x'), undefined)
  assert.equal(parseUsageTotals({ ...good, installs: 0 }), undefined)
  assert.equal(parseUsageTotals({ ...good, reviewed: -1 }), undefined)
  assert.equal(parseUsageTotals({ ...good, drafted: '20' }), undefined)
  assert.equal(parseUsageTotals({ ...good, repaired: 1.5 }), undefined)
})

test('a local file named by the variable is read, and a missing one is not an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyglots-usage-'))
  try {
    const file = join(dir, 'totals.json')
    writeFileSync(file, JSON.stringify(good))
    assert.equal((await loadUsageTotals({ POLYGLOTS_USAGE_TOTALS: file }))?.reviewed, 184230)
    assert.equal(await loadUsageTotals({ POLYGLOTS_USAGE_TOTALS: join(dir, 'missing.json') }), undefined)
    writeFileSync(file, '{not json')
    assert.equal(await loadUsageTotals({ POLYGLOTS_USAGE_TOTALS: file }), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an address that does not answer gives nothing, quickly', async () => {
  const started = Date.now()
  assert.equal(await loadUsageTotals({ POLYGLOTS_USAGE_TOTALS: 'http://127.0.0.1:9/totals.json' }), undefined)
  assert.ok(Date.now() - started < 6000)
})

// The totals cannot be verified (nothing identifies who reports them), so
// the page rounds them down and calls them approximate rather than printing
// a precise figure it cannot stand behind.
test('rounds down to two significant figures, so it never claims more than was reported', () => {
  assert.equal(approx(0), '0')
  assert.equal(approx(87), '87')
  assert.equal(approx(1234), '1,200')
  assert.equal(approx(98_765), '98,000')
  assert.equal(approx(1_049_999), '1,000,000')
})
