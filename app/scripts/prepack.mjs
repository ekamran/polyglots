#!/usr/bin/env node
// npm publishes from app/, but README.md and LICENSE live at the repo root,
// where GitHub shows them. Copied in just before packing so the package page
// on npm has them too; the copies are git-ignored.
//
// Fails closed. It used to skip a missing file in silence, which would have
// published a package with a blank npm page and no licence text, the one file
// a package declaring MIT is obliged to carry. A pack without them is a
// mistake to fix before anything is shipped, never a fallback.

import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = ['README.md', 'LICENSE']

/** Copies the root README.md and LICENSE into `app`. Throws, naming what is missing. */
export function copyRootDocs(app) {
  const root = join(app, '..')
  const missing = DOCS.filter((name) => !existsSync(join(root, name)))
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing from ${root}`)
  }
  for (const name of DOCS) copyFileSync(join(root, name), join(app, name))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    copyRootDocs(join(dirname(fileURLToPath(import.meta.url)), '..'))
  } catch (error) {
    console.error(`✗ Refusing to pack: ${error instanceof Error ? error.message : String(error)}. They are copied from the repo root into the package.`)
    process.exit(1)
  }
}
