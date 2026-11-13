import { z } from 'zod'
import { MAX_API_KEY_CHARS, MAX_ID_CHARS, MAX_QUESTION_CHARS, MAX_UPLOAD_NAME_CHARS } from './limits'

/**
 * input-schemas.ts — contratos de TODOS los cuerpos y queries HTTP externos
 * de la app (vuelta 3 del delta zod).
 *
 * Antes vivían como constantes locales de cada route.ts (duplicadas entre
 * chat y chat/stream); se consolidan aquí para que el test guardián
 * (lib/api/__tests__/input-schemas-guard.test.ts) pueda recorrerlos y fallar
 * si algún array, record o string queda sin cota (H7 — nadie debería poder
 * agregar un esquema externo sin tope sin que la suite se entere).
 *
 * Los esquemas de subjects (createSubject, labs OCR, evoluciones) viven en
 * lib/subjects/schemas.ts y el study spec en @ichtys/ingestion — el guardián
 * también los recorre.
 */

// Espeja packages/db/schema/enums.ts — definido localmente para no cargar el
// cliente DB durante la resolución de módulos en tests.
export const documentTypeEnum = z.enum([
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
])

// Compartido por /api/chat y /api/chat/stream (eran dos copias idénticas).
export const chatInput = z
  .object({
    studyId: z.string().uuid().max(MAX_ID_CHARS),
    question: z.string().min(1).max(MAX_QUESTION_CHARS),
    conversationId: z.string().uuid().max(MAX_ID_CHARS).optional(),
    documentType: documentTypeEnum.optional(),
    topK: z.number().int().positive().max(20).optional(),
  })
  .strict()

// Variante interna de /api/rag/answer-test (sin conversationId).
export const answerTestInput = z
  .object({
    studyId: z.string().uuid().max(MAX_ID_CHARS),
    question: z.string().min(1).max(MAX_QUESTION_CHARS),
    documentType: documentTypeEnum.optional(),
    topK: z.number().int().positive().max(20).optional(),
  })
  .strict()

// /api/ingestion/run
export const triggerInput = z
  .object({
    documentVersionId: z.string().uuid().max(MAX_ID_CHARS),
  })
  .strict()

// PATCH /api/org/settings
export const patchSchema = z.object({
  llmProvider: z.enum(['anthropic', 'openai', 'google', 'groq', 'auto']).optional(),
  similarityThreshold: z.number().min(0.05).max(0.95).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  llmApiKeys: z
    .object({
      anthropic: z.string().min(8).max(MAX_API_KEY_CHARS).nullable().optional(),
      openai: z.string().min(8).max(MAX_API_KEY_CHARS).nullable().optional(),
      google: z.string().min(8).max(MAX_API_KEY_CHARS).nullable().optional(),
      groq: z.string().min(8).max(MAX_API_KEY_CHARS).nullable().optional(),
      openrouter: z.string().min(8).max(MAX_API_KEY_CHARS).nullable().optional(),
    })
    .optional(),
})

// POST /api/studies
export const createStudyInput = z.object({
  name: z.string().min(1).max(200),
  protocolNumber: z.string().max(100).optional(),
})

// GET /api/studies/[id]/specs/diff — query params
export const specDiffQueryInput = z.object({
  v1: z.string().uuid('v1 debe ser un UUID válido').max(MAX_ID_CHARS),
  v2: z.string().uuid('v2 debe ser un UUID válido').max(MAX_ID_CHARS),
})

// POST /api/documents/upload — meta del multipart. El enum incluye 'soa'
// (documentType COMPLETO de subida, a diferencia del de chat/RAG). Vivió como
// constante local de la ruta hasta la vuelta 4 (R4-2): acá lo recorre el
// guardián, y name lleva tope.
export const uploadMetaInput = z.object({
  studyId: z.string().uuid().max(MAX_ID_CHARS),
  name: z.string().min(1).max(MAX_UPLOAD_NAME_CHARS).optional(),
  documentType: z.enum([
    'protocol',
    'investigator_brochure',
    'lab_manual',
    'pharmacy_manual',
    'soa',
    'other',
  ]),
})

// «Equipo y accesos» (docs/decisions/study-membership.md, paso 5). Espeja
// `memberFunction` de packages/db/schema/enums.ts; una prueba compara las dos listas.
export const memberFunctionEnum = z.enum([
  'investigator',
  'study_coordinator',
  'lab_assistant',
  'regulatory_assistant',
  'crf_assistant',
  'operations_director',
  'research_director',
  'monitor',
  'platform_admin',
])

// POST y DELETE /api/org/team/functions
export const teamFunctionInput = z
  .object({
    userId: z.string().min(1).max(MAX_ID_CHARS),
    functionKey: memberFunctionEnum,
  })
  .strict()

// POST /api/org/team/memberships
export const teamMembershipInput = z
  .object({
    userId: z.string().min(1).max(MAX_ID_CHARS),
    studyId: z.string().uuid().max(MAX_ID_CHARS),
    /** «PI», «Sub-PI». Informativo: no autoriza nada. */
    studyLabel: z.string().max(60).optional(),
    /** ISO 8601. Obligatorio para quien es monitor (M4). */
    expiresAt: z.string().datetime({ offset: true }).max(40).optional(),
  })
  .strict()

// DELETE /api/org/team/memberships
export const teamMembershipRevokeInput = z
  .object({
    userId: z.string().min(1).max(MAX_ID_CHARS),
    studyId: z.string().uuid().max(MAX_ID_CHARS),
  })
  .strict()
