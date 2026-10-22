import { validateStudyAccess } from '@ichtys/auth'
import { AnswerEngineError, answerEngine, retrieveRelevantChunks } from '@ichtys/rag'
import {
  canUsePlatformKey,
  getOrgLlmApiKeys,
  getOrgRagConfig,
  getQuotaStatus,
  recordUsage,
  type DocumentType,
} from '@ichtys/db'
import type { AnswerResult, ConversationTurn } from '@ichtys/rag'
import { expandShortQueryForRetrieval } from './query-expander'

/** Registra el consumo de las llamadas del answer engine. Nunca lanza (recordUsage no lanza). */
async function recordAnswerUsage(
  result: Pick<AnswerResult, 'usageEvents'>,
  orgId: string,
  studyId: string,
  userId: string | null,
): Promise<void> {
  for (const event of result.usageEvents ?? []) {
    await recordUsage({
      orgId,
      studyId,
      userId,
      kind: event.kind,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      keySource: event.keySource === 'none' ? 'platform' : event.keySource,
    })
  }
}

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

export type WrapperErrorCode =
  | 'access_denied'
  | 'retrieval_error'
  | 'answer_generation_error'
  | 'provider_unavailable'
  | 'quota_exceeded'

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
  let userId: string | null = null
  let studyName: string | null = null
  let protocolNumber: string | null = null
  try {
    const ctx = await validateStudyAccess(input.studyId)
    orgId = ctx.orgId
    userId = ctx.userId
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
      userId,
    })
  } catch {
    throw new AnswerOrchestratorError('retrieval_error', 'Retrieval failed')
  }

  const retrievalCount = retrievedChunks.length

  // 2b. Config LLM de la org + estado del cupo (ninguno de los dos puede romper la respuesta).
  const [orgLlmApiKeys, orgRagConfig, quotaStatus] = await Promise.all([
    getOrgLlmApiKeys(orgId).catch(() => null),
    getOrgRagConfig(orgId).catch(() => null),
    getQuotaStatus(orgId).catch(() => null),
  ])
  const platformKeyBlocked = quotaStatus ? !canUsePlatformKey(quotaStatus) : false

  // 3. Answer engine puro — tenant isolation ya fue aplicada en retrieval.
  let result: AnswerResult
  try {
    result = await answerEngine({
      question: input.question,
      retrievedChunks,
      conversationHistory: input.conversationHistory,
      llmApiKeys: orgLlmApiKeys,
      llmProviderPreference: orgRagConfig?.llmProvider,
      platformKeyBlocked,
    })
  } catch (err) {
    if (err instanceof AnswerEngineError && err.code === 'quota_exceeded') {
      throw new AnswerOrchestratorError('quota_exceeded', 'Monthly platform quota exceeded')
    }
    // El mensaje del engine ya viene en español y nombra el proveedor elegido:
    // no lo aplanemos a un genérico que esconde el problema de configuración.
    if (err instanceof AnswerEngineError && err.code === 'provider_unavailable') {
      throw new AnswerOrchestratorError('provider_unavailable', err.message)
    }
    throw new AnswerOrchestratorError('answer_generation_error', 'Answer generation failed')
  }

  // 4. Medición de consumo (nunca lanza) — después de tener una respuesta válida.
  await recordAnswerUsage(result, orgId, input.studyId, userId)

  return { ...result, retrievalCount }
}
