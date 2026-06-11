import { z } from 'zod'

/**
 * study-spec.ts — contrato tipado del study spec extraído del protocolo.
 *
 * Diseñado sobre la estructura real de protocolos ICH M11 (validado contra
 * protocolos Lilly GZBP/GZBZ/GZBO/GZQD en español):
 *   - Sección 3:   objetivos y criterios de valoración (endpoints)
 *   - Sección 5.1: criterios de inclusión (numerados)
 *   - Sección 5.2: criterios de exclusión (numerados)
 *   - Sección 1.3: cronograma de actividades / SoA (visitas)
 *
 * Reglas:
 *  - Cada item lleva provenance (sourcePages del documento fuente) y
 *    confidence reportada por el extractor. Sin provenance no hay item.
 *  - El texto se preserva en el idioma original del protocolo.
 *  - Este schema valida TODO insert en study_specs.spec (jsonb).
 */

export const specConfidence = ['high', 'medium', 'low'] as const
export type SpecConfidence = (typeof specConfidence)[number]

const provenanceFields = {
  /** Páginas del documento fuente que respaldan este item (1-based). */
  sourcePages: z.array(z.number().int().positive()).min(1),
  /** Confianza del extractor en la fidelidad del item. */
  confidence: z.enum(specConfidence),
}

/** Criterio de elegibilidad numerado tal como aparece en el protocolo. */
export const eligibilityCriterionSchema = z.object({
  /** Número del criterio en el protocolo ("3", "10a"). Preserva el original. */
  number: z.string().min(1),
  /** Texto completo del criterio, sin parafrasear. */
  text: z.string().min(1),
  ...provenanceFields,
})
export type EligibilityCriterion = z.infer<typeof eligibilityCriterionSchema>

export const endpointType = ['primary', 'secondary', 'exploratory'] as const

/** Par objetivo ↔ criterio de valoración de la sección de objetivos. */
export const studyEndpointSchema = z.object({
  type: z.enum(endpointType),
  /** Objetivo asociado, texto del protocolo. */
  objective: z.string().min(1),
  /** Criterio de valoración (endpoint), texto del protocolo. */
  endpoint: z.string().min(1),
  ...provenanceFields,
})
export type StudyEndpoint = z.infer<typeof studyEndpointSchema>

/** Visita del cronograma de actividades (SoA). */
export const studyVisitSchema = z.object({
  /** Identificador de la visita como figura en el SoA ("Visita 4", "V6"). */
  name: z.string().min(1),
  /** Etiqueta temporal si existe ("Semana 12"). */
  label: z.string().nullable(),
  /** Día nominal del estudio si está definido (puede ser negativo en selección). */
  day: z.number().int().nullable(),
  /** Ventana permitida en días (± N) si está definida. */
  windowDays: z.number().int().nonnegative().nullable(),
  /** Procedimientos de la visita según el SoA. */
  procedures: z.array(z.string().min(1)),
  ...provenanceFields,
})
export type StudyVisit = z.infer<typeof studyVisitSchema>

/** Identificación del protocolo (portada / sinopsis). */
export const studyIdentificationSchema = z.object({
  protocolCode: z.string().nullable(),
  title: z.string().nullable(),
  phase: z.string().nullable(),
  sourcePages: z.array(z.number().int().positive()),
})
export type StudyIdentification = z.infer<typeof studyIdentificationSchema>

export const studySpecSchema = z.object({
  identification: studyIdentificationSchema,
  inclusionCriteria: z.array(eligibilityCriterionSchema),
  exclusionCriteria: z.array(eligibilityCriterionSchema),
  endpoints: z.array(studyEndpointSchema),
  visits: z.array(studyVisitSchema),
})
export type StudySpec = z.infer<typeof studySpecSchema>
