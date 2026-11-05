import { z } from 'zod'
import { MAX_LAB_ITEMS, MAX_LAB_NAME_CHARS, MAX_LAB_UNIT_CHARS } from '../api/limits'

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

// Cotas de entrada externa (vuelta 2 del delta zod, H7): sin .max, un
// arreglo enorme de elementos inválidos acumula un issue por elemento
// aunque zod sea 4.6.7 — ver lib/api/limits.ts.
const labObservationInputSchema = z.object({
  name: z.string().min(1).max(MAX_LAB_NAME_CHARS),
  value: z.number(),
  unit: z.string().max(MAX_LAB_UNIT_CHARS).optional(),
})

export const labOcrExtractSchema = z.object({ text: z.string().min(1).max(50000) }).strict()

export const labOcrConfirmSchema = z
  .object({
    labs: z.array(labObservationInputSchema).max(MAX_LAB_ITEMS).optional(),
  })
  .strict()
