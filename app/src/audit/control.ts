import type { Finding } from '../types.js'

interface Source {
  msgid: string
  msgctxt?: string
  comments: string[]
}

export interface ControlSpec {
  // The only valid translations, when the comment names them. Absent for a
  // free-form setting: a language tag, a number separator, a font spec.
  allowed?: string[]
}

const SIMPLE_TOKEN = /^[a-z][a-z0-9_-]*$/
const IDENTIFIER = /^[a-z]+(?:_[a-z]+)+$/

/**
 * Whether a string is a setting WordPress code reads rather than text a person
 * reads, and if so which values it may take.
 *
 * Core has a handful: "on" with the context "Open Sans font: on or off", which
 * a locale translates to "off" when the font cannot render it; "words" for the
 * word count type; "ltr" for text direction; number_format_decimal_point. The
 * translator comment explains each, and translating the English word breaks the
 * switch.
 *
 * Recognised from the comment or context saying "do not translate", a context
 * ending in "on or off" with an on/off source, an identifier-shaped source, or
 * the text direction context. Not from "on or off" alone: "Display as range"
 * carries the context "Turns reading time range display on or off" and is an
 * ordinary label. A comment about placeholders ("Do not translate SITENAME,
 * SITEURL") is the placeholder rule's business, not this one's.
 *
 * When the source is a simple token and the comment quotes alternatives
 * ("translate this to 'off'"), those and the source are the allowed values.
 */
export function controlSpec(unit: Source): ControlSpec | undefined {
  const comment = unit.comments.join(' ')
  const ctx = unit.msgctxt ?? ''
  const onOff = /\bon or off$/i.test(ctx) && (unit.msgid === 'on' || unit.msgid === 'off')
  const doNotTranslate = /do not translate/i.test(comment) && !/placeholders?/i.test(comment)
  const isControl =
    onOff ||
    doNotTranslate ||
    /do not translate/i.test(ctx) ||
    IDENTIFIER.test(unit.msgid) ||
    (ctx === 'text direction' && (unit.msgid === 'ltr' || unit.msgid === 'rtl'))
  if (!isControl) return undefined

  if (!SIMPLE_TOKEN.test(unit.msgid)) return {}
  const quoted = [...comment.matchAll(/'([a-z][a-z0-9_-]*)'/g)].map((m) => m[1]!)
  const alternatives = onOff ? [...quoted, 'on', 'off'] : quoted
  if (alternatives.filter((v) => v !== unit.msgid).length === 0) return {}
  return { allowed: [...new Set([unit.msgid, ...alternatives])] }
}

const listed = (values: string[]) => {
  const quoted = values.map((v) => `"${v}"`)
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0]!
}

/** An error when a switch holds a value its comment does not allow. */
export function controlFindings(entry: Source & { msgstr: string[] }, spec: ControlSpec): Finding[] {
  if (!spec.allowed) return []
  const wrong = entry.msgstr.find((form) => form.trim() !== '' && !spec.allowed!.includes(form.trim()))
  if (wrong === undefined) return []
  return [
    {
      rule: 'control',
      severity: 'error',
      message: `a setting the code reads, not text: use ${listed(spec.allowed)}, as the translator comment says`,
    },
  ]
}
