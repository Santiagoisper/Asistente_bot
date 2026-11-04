import { z } from 'zod'

/**
 * study-spec.ts — contrato tipado del study spec extraído del protocolo.
 *
 * Diseñado sobre protocolos reales ICH M11 y formatos EU/Boehringer/Sanofi:
 *   - Sección 3:   objetivos y criterios de valoración (endpoints)
 *   - Sección 5.1: criterios de inclusión (numerados; romanos anidados (i)(a))
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

// Cotas de entrada externa (vuelta 2 del delta zod, H7): este schema también
// parsea el PATCH /api/studies/[id]/spec/[specId] — sin .max, un arreglo
// enorme de elementos inválidos acumula un issue por elemento aunque zod sea
// 4.6.7. Los protocolos reales (ICH M11) tienen decenas de items, no miles:
// 2000 es un margen holgado. Constantes aquí porque un package no puede
// importar de apps/web (los topes de web viven en apps/web/lib/api/limits.ts).
/** Elementos máximos por arreglo del spec (criterios, endpoints, visitas). */
export const MAX_SPEC_ITEMS = 2_000
/** Procedimientos máximos por visita del SoA. */
export const MAX_SPEC_VISIT_PROCEDURES = 200
/** Advertencias de extracción máximas guardadas junto al spec. */
export const MAX_SPEC_EXTRACTION_WARNINGS = 200

const provenanceFields = {
  /** Páginas del documento fuente que respaldan este item (1-based). */
  sourcePages: z.array(z.number().int().positive()).min(1),
  /** Confianza del extractor en la fidelidad del item. */
  confidence: z.enum(specConfidence),
}

/** Criterio de elegibilidad numerado tal como aparece en el protocolo. */
export const eligibilityCriterionSchema = z.object({
  /** Número del criterio en el protocolo ("3", "10a", "(ii)", "(iii)(a)"). Preserva el original. */
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
  procedures: z.array(z.string().min(1)).max(MAX_SPEC_VISIT_PROCEDURES),
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
  inclusionCriteria: z.array(eligibilityCriterionSchema).max(MAX_SPEC_ITEMS),
  exclusionCriteria: z.array(eligibilityCriterionSchema).max(MAX_SPEC_ITEMS),
  endpoints: z.array(studyEndpointSchema).max(MAX_SPEC_ITEMS),
  visits: z.array(studyVisitSchema).max(MAX_SPEC_ITEMS),
  /** Fuente de las visitas incorporadas desde una guía SoA separada. */
  visitsSource: z.object({
    documentVersionId: z.string().min(1),
    documentType: z.literal('soa'),
  }).optional(),
  /** Indica que la extracción no produjo un spec utilizable y permite ofrecer reintento. */
  extractionFailed: z.boolean().optional(),
  /** Advertencias de la extracción, guardadas junto al spec para conservar trazabilidad. */
  extractionWarnings: z.array(z.string()).max(MAX_SPEC_EXTRACTION_WARNINGS).optional(),
})
export type StudySpec = z.infer<typeof studySpecSchema>

export function emptyStudySpec(): StudySpec {
  return {
    identification: { protocolCode: null, title: null, phase: null, sourcePages: [] },
    inclusionCriteria: [],
    exclusionCriteria: [],
    endpoints: [],
    visits: [],
  }
}

export function mergeSoaVisits(
  previous: StudySpec | null,
  visits: StudySpec['visits'],
  documentVersionId: string,
): StudySpec {
  return {
    ...(previous ?? emptyStudySpec()),
    visits,
    extractionFailed: false,
    extractionWarnings: [],
    visitsSource: { documentVersionId, documentType: 'soa' },
  }
}
