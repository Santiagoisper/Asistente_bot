import { z } from 'zod'

/**
 * De dónde salió un valor de laboratorio (nota C4, decisión D1): un solo lugar
 * para preguntar por el origen de cada valor. Tres formas posibles. Los
 * perfiles guardados antes de este cambio traen sourceEvolutionId: al leerlos
 * se traduce a la forma evolution (D5: no se rellena hacia atrás ni se inventa
 * procedencia; el dato viejo se conserva, no se agregan campos paralelos).
 */
export const labSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lab_report'), reportId: z.string().uuid() }),
  z.object({ kind: z.literal('evolution'), evolutionId: z.string().uuid() }),
  z.object({ kind: z.literal('pasted_text') }),
])
export type LabSource = z.infer<typeof labSourceSchema>

export const labObservationSchema = z
  .object({
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().optional(),
    sourceEvolutionId: z.string().uuid().optional(),
    /**
     * El rango de referencia tal como lo imprime el laboratorio al lado del valor («hasta 40»,
     * «10 - 40»). Llega solo de un informe que una persona confirmó. Hace falta para los
     * criterios que se miden contra el límite normal de cada laboratorio (transaminasas).
     */
    referenceRange: z.string().max(120).optional(),
    /** Procedencia del valor (D1). Ausente en perfiles anteriores. */
    source: labSourceSchema.optional(),
    /**
     * Fecha de la muestra, YYYY-MM-DD, o null si no se sabe (D2). Nunca se
     * completa con la fecha de carga ni con la de emisión del informe.
     */
    sampleDate: z.string().date().nullable().optional(),
  })
  .transform((observation) => {
    if (
      observation.source !== undefined ||
      observation.sourceEvolutionId === undefined
    ) {
      return observation
    }
    return {
      ...observation,
      source: {
        kind: 'evolution',
        evolutionId: observation.sourceEvolutionId,
      } as const,
    }
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

/**
 * El dato que le falta al perfil para que un criterio deje de estar «a revisar». Solo datos
 * que el sistema sabe leer de una evolución o de un laboratorio: es lo que la guía de
 * dictado le pide al médico (D18).
 */
export const missingDatumSchema = z.enum(['age', 'hba1c', 'egfr', 'weight-height', 'transaminases', 'pancreatitis', 'pregnancy', 'lactation'])
export type MissingDatum = z.infer<typeof missingDatumSchema>

export const criterionAssessmentSchema = z.object({
  criterionNumber: z.string(),
  criterionText: z.string(),
  kind: z.enum(['inclusion', 'exclusion']),
  status: criterionStatusSchema,
  reason: z.string(),
  /** Páginas del protocolo fuente (1-based) desde el study spec. */
  sourcePages: z.array(z.number().int().positive()).optional(),
  /** Presente solo cuando el criterio queda a revisar porque falta un dato que se puede cargar. */
  missing: z.array(missingDatumSchema).optional(),
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
