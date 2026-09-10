import { z } from 'zod'

export const AUDIT_CATEGORIES = [
  'meaning',
  'glossary',
  'title-case',
  'register',
  'fluency',
  'placeholder',
  'other',
] as const

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export const auditBatchJsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', minimum: 1 },
          problem: { type: 'boolean' },
          categories: { type: 'array', items: { type: 'string', enum: [...AUDIT_CATEGORIES] } },
          reason: { type: 'string' },
        },
        required: ['id', 'problem', 'categories', 'reason'],
      },
    },
  },
  required: ['results'],
} as const

export const auditBatchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int().min(1),
      problem: z.boolean(),
      categories: z.array(z.enum(AUDIT_CATEGORIES)),
      reason: z.string(),
    }),
  ),
})

export type AuditResult = z.infer<typeof auditBatchSchema>['results'][number]

export class AuditError extends Error {
  override readonly name = 'AuditError'
}

export interface AuditCandidateId {
  id: number
  key: string
}

export function mapAuditResults(candidates: AuditCandidateId[], payload: unknown): AuditResult[] {
  const parsed = auditBatchSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AuditError(`claude output failed schema validation: ${parsed.error.message.slice(0, 500)}`)
  }

  const byId = new Map<number, AuditResult>()
  for (const result of parsed.data.results) {
    if (!candidates.some((c) => c.id === result.id)) {
      throw new AuditError(`claude output has unknown id ${result.id} for a batch of ${candidates.length}`)
    }
    if (byId.has(result.id)) throw new AuditError(`claude output has a duplicate id ${result.id}`)
    byId.set(result.id, result)
  }

  const missing = candidates.filter((c) => !byId.has(c.id)).map((c) => c.key)
  if (missing.length > 0) {
    throw new AuditError(`claude output is missing ${missing.map((k) => JSON.stringify(k)).join(', ')}`)
  }

  return candidates.map((c) => byId.get(c.id)!)
}
