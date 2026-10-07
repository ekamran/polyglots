import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { bundleClient, renderBundleModule } from '../../scripts/stats-client.mjs'

const committed = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'stats', 'client-bundle.ts'), 'utf8')

describe('the stats client bundle', () => {
  // The bundle is generated and committed, like the translations, so the
  // package never needs esbuild at run time. A page change that skipped
  // `npm run stats-client` would ship the old behaviour; this catches it.
  it('is current with src/stats/page', async () => {
    expect(committed).toBe(renderBundleModule(await bundleClient()))
  }, 30_000)

  it('stays small enough to inline into every page', async () => {
    const code: string = await bundleClient()
    expect(code.length).toBeLessThan(80_000)
  }, 30_000)

  it('carries no node: import, which would break in the browser', async () => {
    const code: string = await bundleClient()
    expect(code).not.toMatch(/\bnode:/)
    expect(code).not.toMatch(/\brequire\(/)
  }, 30_000)
})
