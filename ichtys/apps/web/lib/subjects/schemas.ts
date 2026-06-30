import { z } from 'zod'

export const createSubjectSchema = z
  .object({
    subjectCode: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/, 'Solo letras, números y guiones'),
  })
  .strict()

export const createEvolutionSchema = z
  .object({
    content: z.string().min(1).max(50000),
    visitLabel: z.string().max(100).optional(),
  })
  .strict()

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>
export type CreateEvolutionInput = z.infer<typeof createEvolutionSchema>
