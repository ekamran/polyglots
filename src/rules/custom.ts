import type { Finding, Locale } from '../types.js'
import { intlTag } from '../wporg/locales.js'
import { CUSTOM_RULE } from './names.js'
import type { CustomPattern } from './schema.js'

interface Text {
  msgid: string
  msgstr: string[]
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A case-insensitive regex for a literal, built from the locale's own casing.
 *
 * JavaScript's `i` flag pairs i with I, which is wrong for Turkish, where i
 * pairs with İ and ı with I. Each character becomes a class of its locale
 * upper and lower forms instead, so "içerik" finds "İçerik" and not "ICERIK".
 */
function literalRegex(text: string, locale: Locale): RegExp {
  const body = [...text]
    .map((ch) => {
      const forms = new Set([ch, ch.toLocaleLowerCase(intlTag(locale)), ch.toLocaleUpperCase(intlTag(locale))])
      if (forms.size === 1) return escapeRegExp(ch)
      return `(?:${[...forms].map(escapeRegExp).join('|')})`
    })
    .join('')
  return new RegExp(body, 'gu')
}

// A fresh RegExp per call: a shared one with the g flag keeps lastIndex
// between entries and would skip the next entry's match.
function regexOf(p: CustomPattern, locale: Locale): RegExp {
  return p.text !== undefined ? literalRegex(p.text, locale) : new RegExp(p.find!, `gu${p.ignoreCase ? 'i' : ''}`)
}

const applies = (p: CustomPattern, source: string, locale: Locale) =>
  p.whenSource === undefined || source.toLocaleLowerCase(intlTag(locale)).includes(p.whenSource.toLocaleLowerCase(intlTag(locale)))

const translated = (form: string) => form.trim() !== ''

function message(p: CustomPattern, matched: string): string {
  if (p.kind === 'mistake') {
    return `"${p.text}"${p.right === undefined ? '' : ` -> "${p.right}"`}${p.note ? ` (${p.note})` : ''}`
  }
  return p.note ?? `matches "${matched}"`
}

/**
 * Findings for the hint and error patterns of a locale's rules file.
 *
 * A hint is a suspect: it reaches the model as an automated check with the
 * person's note, and the model decides in context. An error is proof, so the
 * entry is condemned through the ordinary path. Fix patterns are not reported
 * here; the repair step has already applied them.
 */
export function customFindings(entry: Text, patterns: readonly CustomPattern[], locale: Locale): Finding[] {
  const findings: Finding[] = []
  for (const p of patterns) {
    if (p.level === 'fix' || !applies(p, entry.msgid, locale)) continue
    for (const form of entry.msgstr.filter(translated)) {
      const match = regexOf(p, locale).exec(form)
      if (match) {
        findings.push({ rule: CUSTOM_RULE, severity: p.level === 'error' ? 'error' : 'suspect', message: message(p, match[0]) })
        break
      }
    }
  }
  return findings
}

function capitaliseLike(matched: string, replacement: string, locale: Locale): string {
  const first = [...matched][0]
  if (!first || first === first.toLocaleLowerCase(intlTag(locale))) return replacement
  const [head = '', ...rest] = [...replacement]
  return head.toLocaleUpperCase(intlTag(locale)) + rest.join('')
}

/**
 * The fix patterns applied to every translated form, with the notes of the
 * ones that changed something; undefined when none did.
 *
 * A literal replacement keeps the capital of what it replaced, so "Önizleme"
 * becomes "Ön izleme" at the start of a label. A replacement that would leave
 * a form empty is not applied: that destroys a translation rather than
 * repairing it.
 */
export function applyFixPatterns(
  entry: Text,
  patterns: readonly CustomPattern[],
  locale: Locale,
): { forms: string[]; notes: string[] } | undefined {
  let forms = entry.msgstr
  const notes: string[] = []
  for (const p of patterns) {
    if (p.level !== 'fix' || p.replace === undefined || !applies(p, entry.msgid, locale)) continue
    let changed = false
    forms = forms.map((form) => {
      if (!translated(form)) return form
      const next =
        p.text !== undefined
          ? form.replace(regexOf(p, locale), (m) => capitaliseLike(m, p.replace!, locale))
          : form.replace(regexOf(p, locale), p.replace!)
      if (next === form || !translated(next)) return form
      changed = true
      return next
    })
    if (changed) notes.push(p.note ?? `replaced ${p.text ?? p.find} with "${p.replace}"`)
  }
  return notes.length > 0 ? { forms, notes } : undefined
}
