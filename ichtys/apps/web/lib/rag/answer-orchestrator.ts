import { validateStudyAccess } from '@ichtys/auth'
import { answerEngine, retrieveRelevantChunks } from '@ichtys/rag'
import type { DocumentType } from '@ichtys/db'
import type { AnswerResult, ConversationTurn } from '@ichtys/rag'
import { expandShortQueryForRetrieval } from './query-expander'

/**
 * answer-orchestrator.ts — server-side wrapper que conecta auth, retrieval y
 * answer engine en una sola operación segura.
 *
 * Responsabilidades:
 *  1. Validar acceso al study (resuelve orgId desde Clerk; nunca lo acepta del input).
 *  2. Recuperar chunks con filtro de tenant (org + study) en la query SQL.
 *  3. Invocar el answer engine puro con los chunks recuperados.
 *  4. Sanitizar y envolver todos los errores antes de propagarlos.
 *
 * Lo que NO hace:
 *  - No persiste mensajes ni citas en DB.
 *  - No hace streaming.
 *  - No expone HTTP.
 *  - No loguea prompts, chunks ni PHI.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type GenerateAnswerForStudyInput = {
  studyId: string
  question: string
  documentType?: DocumentType
  topK?: number
  /**
   * Turnos previos de la conversación (cargados por el caller desde DB, ya
   * tenant-validados). Contexto para interpretar la pregunta — nunca evidencia.
   * El retrieval sigue usando solo la pregunta actual (limitación conocida:
   * follow-ups que dependen 100% del historial pueden recuperar peor).
   */
  conversationHistory?: ConversationTurn[]
}

export type GenerateAnswerForStudyResult = AnswerResult & {
  /** Número de chunks recuperados antes de aplicar el umbral de similitud. */
  retrievalCount: number
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type WrapperErrorCode = 'access_denied' | 'retrieval_error' | 'answer_generation_error'

export class AnswerOrchestratorError extends Error {
  constructor(
    readonly code: WrapperErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AnswerOrchestratorError'
  }
}

// ---------------------------------------------------------------------------
// Wrapper principal
// ---------------------------------------------------------------------------

/**
 * Punto de entrada server-side para generar una respuesta grounded para un study.
 *
 * `orgId` NUNCA se acepta como input — se resuelve exclusivamente desde el
 * token de Clerk vía `validateStudyAccess`.
 */
export async function generateAnswerForStudy(
  input: GenerateAnswerForStudyInput,
): Promise<GenerateAnswerForStudyResult> {
  // 1. Validar acceso y resolver orgId desde el token de Clerk.
  //    Cualquier fallo (auth, org, study) se envuelve como access_denied.
  let orgId: string
  let studyName: string | null = null
  let protocolNumber: string | null = null
  try {
    const ctx = await validateStudyAccess(input.studyId)
    orgId = ctx.orgId
    studyName = ctx.study.name
    protocolNumber = ctx.study.protocolNumber
  } catch {
    throw new AnswerOrchestratorError('access_denied', 'Study access check failed')
  }

  const retrievalQuery = expandShortQueryForRetrieval({
    question: input.question,
    studyName,
    protocolNumber,
  })

  // 2. Retrieval con filtro de tenant en la query SQL.
  let retrievedChunks: Awaited<ReturnType<typeof retrieveRelevantChunks>>
  try {
    retrievedChunks = await retrieveRelevantChunks({
      queryText: retrievalQuery,
      orgId,
      studyId: input.studyId,
      topK: input.topK,
      documentType: input.documentType,
    })
  } catch {
    throw new AnswerOrchestratorError('retrieval_error', 'Retrieval failed')
  }

  const retrievalCount = retrievedChunks.length

  // 3. Answer engine puro — tenant isolation ya fue aplicada en retrieval.
  let result: AnswerResult
  try {
    result = await answerEngine({
      question: input.question,
      retrievedChunks,
      conversationHistory: input.conversationHistory,
    })
  } catch {
    throw new AnswerOrchestratorError('answer_generation_error', 'Answer generation failed')
  }

  return { ...result, retrievalCount }
}
