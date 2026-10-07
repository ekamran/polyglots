// Rewrites i18n/stats/stats.pot from the phrase table in src/stats/i18n.ts.
// Run after changing an English string: `npm run stats-pot`.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_NOTES, ALL_PHRASES } from '../src/stats/i18n.js'
import { renderPot } from '../src/stats/pot.js'

const out = join(import.meta.dirname, '..', 'i18n', 'stats', 'stats.pot')
writeFileSync(out, renderPot(ALL_PHRASES, ALL_NOTES))
console.log(`stats-pot: wrote ${Object.keys(ALL_PHRASES).length} strings to i18n/stats/stats.pot`)
