import type { DraftEngineName } from './errors.js'

// printf: %[argnum$][flags][width][.precision]specifier, PHP's custom pad flag is a quote plus any char.
const PLACEHOLDER = /%(?:\d+\$)?(?:[-+ 0#]|'[\s\S])*\d*(?:\.\d+)?[bcdeEfFgGosuxX]|\{[A-Za-z_][\w.-]*\}|###[A-Za-z0-9_]+###/g

function countPlaceholders(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [match] of text.replaceAll('%%', '').matchAll(PLACEHOLDER)) {
    counts.set(match, (counts.get(match) ?? 0) + 1)
  }
  return counts
}

export function missingPlaceholders(source: string, draft: string): string[] {
  const inDraft = countPlaceholders(draft)
  const missing: string[] = []
  for (const [ph, n] of countPlaceholders(source)) {
    if ((inDraft.get(ph) ?? 0) < n) missing.push(ph)
  }
  return missing
}

export type WarningSink = (message: string) => void

export function warnMissingPlaceholders(
  engine: DraftEngineName,
  key: string,
  source: string,
  draft: string,
  onWarning?: WarningSink,
): void {
  if (!onWarning) return
  const missing = missingPlaceholders(source, draft)
  if (missing.length === 0) return
  onWarning(`${engine}: draft for ${JSON.stringify(key)} lost placeholder(s) ${missing.join(', ')}`)
}
