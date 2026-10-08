// The translation template for the stats page, rendered from the phrase table
// rather than kept by hand, so the English a translator works from is the
// English the page prints. A test compares the committed file with this output;
// `npm run stats-pot` rewrites it.
//
// No POT-Creation-Date: a date would change the file on every regeneration and
// make the freshness test fail for no reason.

const quote = (text: string) =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`

export function renderPot(phrases: Record<string, string>, notes: Partial<Record<string, string>>): string {
  const header = [
    '# Strings of the polyglots stats page (polyglots stats).',
    '# Translate into i18n/stats/<WordPress locale>.po, for example de_DE.po, and',
    '# set the Language header. The build embeds every .po in this folder;',
    '# fuzzy, empty and outdated strings are left out and show in English.',
    'msgid ""',
    'msgstr ""',
    '"Project-Id-Version: polyglots stats\\n"',
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    '',
  ].join('\n')
  const entries = Object.entries(phrases).map(([key, text]) => {
    const note = notes[key]
    return `${note === undefined ? '' : `#. ${note}\n`}msgctxt ${quote(key)}\nmsgid ${quote(text)}\nmsgstr ""\n`
  })
  return `${header}\n${entries.join('\n')}`
}
