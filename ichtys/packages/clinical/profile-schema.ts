import { z } from 'zod'

export const labObservationSchema = z.object({
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().optional(),
  sourceEvolutionId: z.string().uuid().optional(),
})

export const pendingLabReviewSchema = z.object({
  requiresHumanReview: z.literal(true),
  extractedAt: z.string(),
  labs: z.array(labObservationSchema),
  redactedSourcePreview: z.string().max(500).optional(),
})
export type PendingLabReview = z.infer<typeof pendingLabReviewSchema>

export const medicationSchema = z.object({
  name: z.string().min(1),
  dose: z.string().optional(),
  frequency: z.string().optional(),
})

export const fieldConfidenceLevelSchema = z.enum(['high', 'medium', 'low'])
export type FieldConfidenceLevel = z.infer<typeof fieldConfidenceLevelSchema>

export const profileFieldConfidenceSchema = z.object({
  ageYears: fieldConfidenceLevelSchema.optional(),
  bloodPressure: fieldConfidenceLevelSchema.optional(),
  // z.record con DOS argumentos (ADR-8 §3): zod 4 ya no acepta la forma de
  // uno (claves implícitas string). Mismo significado histórico: claves
  // arbitrarias (hba1c, metformina, ...) → nivel de confianza. Protegido por
  // el round-trip del perfil cifrado en formato viejo (M6).
  labs: z.record(z.string(), fieldConfidenceLevelSchema).optional(),
  medications: z.record(z.string(), fieldConfidenceLevelSchema).optional(),
  conditions: z.record(z.string(), fieldConfidenceLevelSchema).optional(),
})
export type ProfileFieldConfidence = z.infer<typeof profileFieldConfidenceSchema>

/**
 * Lo que un modelo (o las reglas de extracción) leyó en una evolución y todavía
 * nadie confirmó. No forma parte del perfil hasta que una persona lo acepta
 * (marco normativo, regla R6): el screening no lo ve.
 */
export const pendingProfileProposalSchema = z.object({
  requiresHumanReview: z.literal(true),
  evolutionId: z.string().uuid(),
  extractedAt: z.string(),
  facts: z.object({
    ageYears: z.number().int().positive().optional(),
    systolic: z.number().int().positive().optional(),
    diastolic: z.number().int().positive().optional(),
    labs: z.array(labObservationSchema).default([]),
    medications: z.array(medicationSchema).default([]),
    conditions: z.array(z.string()).default([]),
  }),
  fieldConfidence: profileFieldConfidenceSchema.default({}),
})
export type PendingProfileProposal = z.infer<typeof pendingProfileProposalSchema>

export const patientProfileSchema = z.object({
  version: z.literal(1).default(1),
  demographics: z
    .object({
      ageYears: z.number().int().positive().optional(),
    })
    .optional(),
  vitals: z
    .object({
      systolic: z.number().int().positive().optional(),
      diastolic: z.number().int().positive().optional(),
      bloodPressureLabel: z.string().optional(),
    })
    .optional(),
  labs: z.array(labObservationSchema).default([]),
  medications: z.array(medicationSchema).default([]),
  conditions: z.array(z.string()).default([]),
  /** Confianza por campo extraído (Fase 2.5). */
  fieldConfidence: profileFieldConfidenceSchema.optional(),
  /** Labs OCR pendientes de confirmación humana (URS-007). */
  pendingLabReview: pendingLabReviewSchema.optional(),
  /** Propuestas extraídas de evoluciones, pendientes de confirmación humana (R6). */
  pendingEvolutionProposals: z.array(pendingProfileProposalSchema).optional(),
  lastUpdatedAt: z.string().optional(),
  lastEvolutionId: z.string().uuid().optional(),
})

export type PatientProfile = z.infer<typeof patientProfileSchema>
export type LabObservation = z.infer<typeof labObservationSchema>
export type Medication = z.infer<typeof medicationSchema>

export const criterionStatusSchema = z.enum(['pass', 'fail', 'unknown'])
export type CriterionStatus = z.infer<typeof criterionStatusSchema>

export const criterionAssessmentSchema = z.object({
  criterionNumber: z.string(),
  criterionText: z.string(),
  kind: z.enum(['inclusion', 'exclusion']),
  status: criterionStatusSchema,
  reason: z.string(),
  /** Páginas del protocolo fuente (1-based) desde el study spec. */
  sourcePages: z.array(z.number().int().positive()).optional(),
})

export type CriterionAssessment = z.infer<typeof criterionAssessmentSchema>

export function emptyPatientProfile(): PatientProfile {
  return patientProfileSchema.parse({ version: 1 })
}

export function parsePatientProfile(raw: unknown): PatientProfile {
  const parsed = patientProfileSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return emptyPatientProfile()
}
