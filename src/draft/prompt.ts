import type { Locale } from '../types.js'

// The draft engine's own prompt, kept apart from the client that sends it so
// that hashing it does not drag the OpenAI SDK into every command's module
// graph. `draftConfigHash` reads it: changing a word here invalidates every
// cached draft, which is the point of giving the draft table a config_hash.

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

export function describeLocale(locale: Locale): string {
  const tag = locale.replaceAll('_', '-')
  let name: string | undefined
  try {
    name = languageNames.of(tag)
  } catch {
    name = undefined
  }
  return name && name !== tag ? `${name} (${locale})` : locale
}

export function draftSystemPrompt(locale: Locale, nplurals: number): string {
  return [
    `You are a professional WordPress UI translator. Translate each item from English (en) into ${describeLocale(locale)}.`,
    'These are gettext strings from WordPress core, plugins and themes: UI labels, messages, settings.',
    'Rules:',
    '- Keep every placeholder exactly as written (%s, %d, %1$s, %2$d, %.2f, {name}, ###TOKEN###) and in a natural position.',
    '- Keep HTML tags, attributes, entities, Markdown, whitespace, leading/trailing spaces and newlines intact.',
    '- Do not translate code, URLs, shortcodes, or option/CSS/PHP identifiers.',
    '- Use the msgctxt and comments as disambiguation hints; produce natural, concise UI wording.',
    `- The target locale has ${nplurals} plural form(s). For an item WITHOUT "msgidPlural", return exactly 1 draft. For an item WITH "msgidPlural", return exactly ${nplurals} drafts: index 0 translates "msgid" (singular), the remaining indexes translate "msgidPlural" for the locale's other plural forms, in order.`,
    // Items are identified by a number, never by the gettext key. A key can
    // begin with a newline and end in spaces, and a model asked to echo one
    // back will quietly normalise it; the reply then looks well-formed while
    // the entry it names matches nothing. The review path learned this first.
    '- Return every input item, echoing its numeric "id" unchanged.',
    'Return ONLY a JSON object of the shape {"items":[{"id":1,"drafts":["..."]}]} with no prose.',
  ].join('\n')
}

