import { z } from 'zod'
import { BUILT_IN_RULES } from './names.js'

export const GUIDANCE_LIMIT = 1500

export type PatternLevel = 'hint' | 'error' | 'fix'

/**
 * One custom check, in the form the rule engine runs. A `mistakes` entry from
 * the file arrives here as a `hint` pattern with `right` kept for its message.
 */
export interface CustomPattern {
  // Which section of the file it was written in. A mistake is reported as
  // wrong -> right; a pattern by its note.
  kind: 'mistake' | 'pattern'
  text?: string
  find?: string
  ignoreCase: boolean
  replace?: string
  // The suggested wording of a common mistake, shown in its finding.
  right?: string
  level: PatternLevel
  whenSource?: string
  note?: string
}

export interface LocaleRules {
  rules?: { enable: string[]; disable: string[] }
  glossaryStemRatio?: number
  properNouns?: { always?: string[]; dateOnly?: string[] }
  patterns: CustomPattern[]
  guidance?: string
}

const ruleName = z.string().superRefine((name, ctx) => {
  if (!(BUILT_IN_RULES as readonly string[]).includes(name)) {
    ctx.addIssue({ code: 'custom', message: `"${name}" is not a built-in rule. Valid names: ${BUILT_IN_RULES.join(', ')}` })
  }
})

const compiles = (source: string) => {
  try {
    new RegExp(source, 'u')
    return true
  } catch {
    return false
  }
}

const mistake = z
  .object({
    wrong: z.string().min(1),
    right: z.string().optional(),
    note: z.string().optional(),
  })
  .strict()

const pattern = z
  .object({
    text: z.string().min(1).optional(),
    find: z.string().min(1).refine(compiles, { message: 'is not a valid regular expression' }).optional(),
    ignoreCase: z.boolean().optional(),
    replace: z.string().optional(),
    level: z.enum(['hint', 'error', 'fix']).optional(),
    when: z.object({ source: z.string().min(1) }).strict().optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.text === undefined) === (p.find === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'needs exactly one of "text" or "find"' })
    }
    if (p.level === 'fix' && p.replace === undefined) {
      ctx.addIssue({ code: 'custom', path: ['replace'], message: 'is required when level is fix' })
    }
  })

export const localeRulesSchema = z
  .object({
    rules: z
      .object({ enable: z.array(ruleName).default([]), disable: z.array(ruleName).default([]) })
      .strict()
      .optional(),
    glossaryStemRatio: z.number().gt(0).max(1).optional(),
    properNouns: z
      .object({ always: z.array(z.string()).optional(), dateOnly: z.array(z.string()).optional() })
      .strict()
      .optional(),
    mistakes: z.array(mistake).default([]),
    patterns: z.array(pattern).default([]),
    guidance: z.string().max(GUIDANCE_LIMIT, { message: `is longer than ${GUIDANCE_LIMIT} characters` }).optional(),
  })
  .strict()

export type RawLocaleRules = z.infer<typeof localeRulesSchema>

// Mistakes and patterns become one list, mistakes first, in the order written.
// Optional fields are only set when present, which keeps the normalised value
// (and so its fingerprint) free of keys the person never wrote.
export function normalise(raw: RawLocaleRules): LocaleRules {
  const patterns: CustomPattern[] = [
    ...raw.mistakes.map((m) => ({
      kind: 'mistake' as const,
      text: m.wrong,
      replace: undefined,
      ...(m.right === undefined ? {} : { right: m.right }),
      level: 'hint' as const,
      ignoreCase: true,
      ...(m.note === undefined ? {} : { note: m.note }),
    })),
    ...raw.patterns.map((p) => ({
      kind: 'pattern' as const,
      ...(p.text === undefined ? {} : { text: p.text }),
      ...(p.find === undefined ? {} : { find: p.find }),
      ...(p.replace === undefined ? {} : { replace: p.replace }),
      level: p.level ?? 'hint',
      // A literal is always matched case-insensitively; only a regex opts in.
      ignoreCase: p.text !== undefined ? true : (p.ignoreCase ?? false),
      ...(p.when === undefined ? {} : { whenSource: p.when.source }),
      ...(p.note === undefined ? {} : { note: p.note }),
    })),
  ]
  const guidance = raw.guidance?.trim()
  return {
    ...(raw.rules === undefined ? {} : { rules: raw.rules }),
    ...(raw.glossaryStemRatio === undefined ? {} : { glossaryStemRatio: raw.glossaryStemRatio }),
    ...(raw.properNouns === undefined ? {} : { properNouns: raw.properNouns }),
    patterns,
    ...(guidance ? { guidance } : {}),
  }
}
