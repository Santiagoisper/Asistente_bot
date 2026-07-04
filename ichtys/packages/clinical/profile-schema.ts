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
  labs: z.record(fieldConfidenceLevelSchema).optional(),
  medications: z.record(fieldConfidenceLevelSchema).optional(),
  conditions: z.record(fieldConfidenceLevelSchema).optional(),
})
export type ProfileFieldConfidence = z.infer<typeof profileFieldConfidenceSchema>

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
