// Empties dist/ before tsc writes it. tsc never deletes output whose source
// is gone, so a renamed or removed module lived on in dist/ and would ship in
// the npm package and be importable by mistake. Runs after prebuild's
// no-live-run guard, so it never pulls dist/ out from under a running review.
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), { recursive: true, force: true })
