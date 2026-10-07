import { spawn } from 'node:child_process'
import { UsageError } from './args.js'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { renderDefaultRules, rulesHeader } from '../rules/defaults.js'
import { loadLocaleRules, localeRulesFile } from '../rules/load.js'
import { GUIDANCE_LIMIT } from '../rules/schema.js'
import { packLine } from '../rules/support.js'
import type { Locale } from '../types.js'

export type OpenEditor = (file: string) => Promise<void>

// $VISUAL, then $EDITOR, then vi, the order git and crontab use. Run through
// the shell so an editor configured with arguments ("code -w") works.
export const openInEditor: OpenEditor = (file) =>
  new Promise((resolve, reject) => {
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    const child = spawn(`${editor} ${JSON.stringify(file)}`, { stdio: 'inherit', shell: true })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${editor} exited with ${code}`))))
  })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A short account of what a locale's rules file sets. Throws RulesFileError. */
export function describeRules(locale: Locale): string[] {
  const file = localeRulesFile(locale)
  const rules = loadLocaleRules(locale)
  // First, because it says what the file is layered over: a pack's profile,
  // or nothing but the universal set.
  const pack = packLine(locale)
  if (!rules) {
    return [pack, `No rules file for ${locale}; the built-in defaults apply.`, `Create one with: polyglots rules edit ${locale}`]
  }
  const mistakes = rules.patterns.filter((p) => p.kind === 'mistake').length
  const patterns = rules.patterns.length - mistakes
  const levels = ['hint', 'error', 'fix']
    .map((level) => [level, rules.patterns.filter((p) => p.level === level).length] as const)
    .filter(([, n]) => n > 0)
    .map(([level, n]) => `${n} ${level}`)
  return [
    pack,
    `${file} is valid.`,
    rules.rules
      ? `  rules: ${plural(rules.rules.enable.length, 'enabled extra')}, ${plural(rules.rules.disable.length, 'disabled')}`
      : '  rules: built-in',
    ...(rules.glossaryStemRatio === undefined ? [] : [`  glossaryStemRatio: ${rules.glossaryStemRatio}`]),
    ...(rules.properNouns ? [`  properNouns: ${Object.keys(rules.properNouns).join(', ')} replaced`] : []),
    `  ${plural(mistakes, 'mistake')}, ${plural(patterns, 'pattern')}${levels.length ? ` (${levels.join(', ')})` : ''}`,
    `  guidance: ${rules.guidance ? `${rules.guidance.length} of ${GUIDANCE_LIMIT} characters` : 'none'}`,
  ]
}

/**
 * Duplicates one locale's rules file as another's: nl_NL to nl_BE, de_DE to
 * de_DE_formal. Duplication, not inheritance: the copy is its own file from
 * then on, and a later edit to either touches only that one.
 *
 * Verbatim, comments included, except a header line naming the source locale,
 * which is renamed. The source must be valid, since copying a broken file
 * makes two; an existing target is kept unless `force`.
 */
export async function copyRules(from: Locale, to: Locale, force = false): Promise<string[]> {
  const source = localeRulesFile(from)
  if (!existsSync(source)) throw new UsageError(`No rules file for ${from} to copy (${source})`)
  loadLocaleRules(from)
  const target = localeRulesFile(to)
  if (existsSync(target) && !force) {
    throw new UsageError(`${target} already exists; pass --force to replace it`)
  }
  const text = await readFile(source, 'utf8')
  const [first = '', ...rest] = text.split('\n')
  const renamed = first.startsWith('# polyglots rules for ') ? [rulesHeader(to), ...rest].join('\n') : text
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, renamed, 'utf8')
  return [`Copied ${from} to ${to}.`, ...describeRules(to)]
}

/**
 * Opens the locale's rules file in the editor, writing the commented defaults
 * first when there is none, and checks it once the editor closes. An existing
 * file is never overwritten.
 */
export async function editRules(locale: Locale, openEditor: OpenEditor): Promise<string[]> {
  const file = localeRulesFile(locale)
  if (!existsSync(file)) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, renderDefaultRules(locale), 'utf8')
  }
  await openEditor(file)
  return describeRules(locale)
}
