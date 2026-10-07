import { z } from 'zod'

export const reviewBatchJsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', minimum: 1 },
          text: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          fuzzy: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['id', 'text', 'fuzzy', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const

export const reviewResultSchema = z.object({
  id: z.number().int().min(1),
  text: z.array(z.string().min(1)).min(1),
  fuzzy: z.boolean(),
  reason: z.string(),
})

export const reviewBatchSchema = z.object({
  results: z.array(reviewResultSchema),
})

export type ReviewBatch = z.infer<typeof reviewBatchSchema>
