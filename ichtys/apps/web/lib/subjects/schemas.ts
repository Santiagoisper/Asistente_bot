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

/**
 * De dónde salió el texto de la evolución cuando no se escribió a mano
 * (docs/decisions/consulta-dictada.md, D7). Solo números y nombres de modelo:
 * nada de lo dictado. Va al registro, no a la evolución.
 */
export const evolutionSourceSchema = z
  .object({
    kind: z.literal('dictation'),
    durationSec: z.number().int().min(0).max(4 * 60 * 60),
    model: z.string().trim().min(1).max(80),
    modelRevision: z.string().trim().min(1).max(80),
    corrections: z.number().int().min(0).max(500),
    missingBlocks: z.number().int().min(0).max(50),
    /** Opcionales: un cliente anterior a este cambio no los manda. */
    layout: z.enum(['blocks', 'narrative']).optional(),
    /**
     * El código del sujeto que la persona confirmó en el aviso de antes de grabar (D23). La ruta
     * lo compara con el sujeto donde se guarda la evolución: si no coincide, no guarda. No va
     * al registro: ahí queda `subjectConfirmed`, que es el resultado de esa comparación.
     */
    confirmedSubjectCode: z.string().trim().min(1).max(64).optional(),
    repetitions: z.number().int().min(0).max(50).optional(),
  })
  .strict()
export type EvolutionSource = z.infer<typeof evolutionSourceSchema>

export const createEvolutionSchema = z
  .object({
    content: z.string().min(1).max(50000),
    visitLabel: z.string().max(100).optional(),
    source: evolutionSourceSchema.optional(),
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
