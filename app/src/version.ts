import { createRequire } from 'node:module'

// The build puts this one directory below the package root, exactly as it does
// cli.js, so the relative path holds in both src and dist.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

export const VERSION: string = version
