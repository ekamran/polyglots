#!/usr/bin/env node
// npm publishes from app/, but README.md and LICENSE live at the repo root,
// where GitHub shows them. Copied in just before packing so the package page
// on npm has them too; the copies are git-ignored.

import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['README.md', 'LICENSE']) {
  const from = join(app, '..', name)
  if (existsSync(from)) copyFileSync(from, join(app, name))
}
