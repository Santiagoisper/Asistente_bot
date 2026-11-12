import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import {
  AnswerOrchestratorError,
  generateAnswerForStudy,
} from '../../../lib/rag/answer-orchestrator'
import {
  getOrCreateConversation,
  loadConversationHistory,
  persistAssistantMessageAndCitations,
  persistUserMessage,
  writeAuditLog,
} from '../../../lib/chat/persistence'
import {
  enforceSlidingWindowRateLimit,
  getChatRateLimitConfig,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from '../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../lib/observability/logger'
import { JsonBodyTooLargeError, readJsonBody } from '../../../lib/api/body-limit'
import { chatInput } from '../../../lib/api/input-schemas'

/**
 * POST /api/chat — grounded answer engine with full chat persistence.
 *
 * Flow:
 *   auth → study access → conversation → load history → user message
 *   → rag.answer.requested → generateAnswerForStudy (con memoria)
 *   → assistant message + citations → rag.answer.completed
 *
 * Memoria por estudio (cross-session): el historial se carga desde DB por
 * conversationId — retomar una conversación con el mismo conversationId
 * restaura el contexto aunque sea otra sesión HTTP u otro día.
 *
 * Rules (CLAUDE.md, SECURITY.md):
 *  - orgId always from Clerk token — never from body or query params.
 *  - studyId validated against active org before any RAG operation.
 *  - No prompts, embeddings, chunks or PHI in logs or responses.
 *  - Audit log writes are mandatory for rag.answer.* events.
 *  - No streaming in this phase. No UI. No PDF viewer.
 */

export const runtime = 'nodejs'

async function devLogError(step: string): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return
  console.error('[chat:500]', { step, code: 'chat_internal_error' })
}

const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

function hasOrgField(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return FORBIDDEN_ORG_FIELDS.some((field) => field in (body as Record<string, unknown>))
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  const startMs = Date.now()
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/chat', method: 'POST' }))

  // 1. Reject org identifiers from query params.
  const url = new URL(req.url)
  for (const field of FORBIDDEN_ORG_FIELDS) {
    if (url.searchParams.has(field)) {
      return new Response('Bad Request', { status: 400 })
    }
  }

  // 2. Parse body — tope de bytes ANTES de parsear (413, H7 vuelta 2). El
  //    studyId viene del body, así que el auth no puede adelantarse: el corte
  //    por bytes es la barrera barata de esta ruta.
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) {
      return new Response('Payload Too Large', { status: 413 })
    }
    return new Response('Bad Request', { status: 400 })
  }

  // 3. Explicit rejection of org fields (defense-in-depth before Zod).
  if (hasOrgField(body)) {
    return new Response('Bad Request', { status: 400 })
  }

  // 4. Zod validation (.strict() rejects unknown keys).
  const parsed = chatInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  const { studyId, question, conversationId: inputConversationId, documentType, topK } = parsed.data

  // 5. Auth + study access — orgId resolved from Clerk token.
  let userId: string
  let orgId: string
  try {
    const ctx = await validateStudyAccess(studyId)
    userId = ctx.userId
    orgId = ctx.orgId
  } catch (err) {
    return handleApiError(err)
  }

  const chatRlConfig = getChatRateLimitConfig()
  const rateLimit = await enforceSlidingWindowRateLimit({
    key: `chat:${orgId}:${userId}:${studyId}`,
    limit: chatRlConfig.limit,
    windowSeconds: chatRlConfig.windowSeconds,
    orgKey: `chat-org:${orgId}`,
    orgLimit: chatRlConfig.orgLimit,
  })
  if (rateLimit.limited) {
    if (rateLimit.reason === 'unavailable') {
      log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/chat', method: 'POST', userId, statusCode: 503 }))
      return rateLimitUnavailableResponse()
    }
    log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/chat', method: 'POST', userId, statusCode: 429 }))
    return rateLimitResponse(rateLimit.retryAfterSeconds)
  }

  // 6. Get or create conversation (validates ownership if conversationId provided).
  let conversationId: string
  try {
    conversationId = await getOrCreateConversation({
      conversationId: inputConversationId,
      orgId,
      studyId,
      userId,
    })
  } catch (err) {
    return handleApiError(err)
  }

  // 7. Load conversation history BEFORE persisting the new user message —
  //    el turno actual no debe duplicarse en el historial del prompt.
  //    Memoria cross-session: el historial vive en DB, no en la sesión HTTP.
  let conversationHistory: Awaited<ReturnType<typeof loadConversationHistory>>
  try {
    conversationHistory = await loadConversationHistory({ conversationId, orgId, studyId })
  } catch {
    await devLogError('loadConversationHistory')
    return new Response('Internal Server Error', { status: 500 })
  }

  // 8–9. Persist user message + audit «requested» en la misma transacción (R3).
  //      Metadata segura: sin texto de la pregunta ni PHI.
  let userMessageId: string
  try {
    userMessageId = await persistUserMessage({
      conversationId,
      orgId,
      studyId,
      question,
      audit: {
        action: 'rag.answer.requested',
        orgId,
        studyId,
        userId,
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: {
          documentType: documentType ?? null,
          topK: topK ?? null,
          historyTurns: conversationHistory.length,
        },
      },
    })
  } catch {
    await devLogError('persistUserMessage')
    return new Response('Internal Server Error', { status: 500 })
  }

  // 10. RAG wrapper — retrieval + answer engine (con memoria de conversación).
  let result: Awaited<ReturnType<typeof generateAnswerForStudy>>
  try {
    result = await generateAnswerForStudy({ studyId, question, documentType, topK, conversationHistory })
  } catch (ragErr) {
    const code = ragErr instanceof AnswerOrchestratorError ? ragErr.code : 'answer_failed'
    console.error('[POST /api/chat] generateAnswerForStudy failed', { code })
    // No se guardó ninguna respuesta: este registro no acompaña a un dato.
    try {
      await writeAuditLog({
        action: 'rag.answer.failed',
        orgId,
        studyId,
        userId,
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: { error: code },
      })
    } catch {
      // audit write failure non-fatal
    }
    if (ragErr instanceof AnswerOrchestratorError && ragErr.code === 'quota_exceeded') {
      return Response.json(
        {
          error: 'quota_exceeded',
          message:
            'Se agotó el cupo mensual incluido de esta organización. Cargá tu propia clave de modelo en Ajustes para seguir usando el chat, o ampliá el plan.',
        },
        { status: 402 },
      )
    }
    if (ragErr instanceof AnswerOrchestratorError && ragErr.code === 'provider_unavailable') {
      return Response.json(
        { error: 'provider_unavailable', message: ragErr.message },
        { status: 503 },
      )
    }
    return new Response('Internal Server Error', { status: 500 })
  }

  // 11–12. Persist assistant message + citations + audit «completed» en una
  //        sola transacción (R3). Metadata segura.
  let assistantMessageId: string
  try {
    assistantMessageId = await persistAssistantMessageAndCitations({
      conversationId,
      orgId,
      studyId,
      answer: result.answer,
      confidence: result.confidence,
      evidences: result.evidences,
      audit: {
        action: 'rag.answer.completed',
        orgId,
        studyId,
        userId,
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: {
          confidence: result.confidence,
          evidenceCount: result.evidences.length,
          retrievalCount: result.retrievalCount,
        },
      },
    })
  } catch {
    await devLogError('persistAssistantMessageAndCitations')
    return new Response('Internal Server Error', { status: 500 })
  }

  // 13. Return structured response — no prompts, embeddings or raw chunks.
  log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/chat', method: 'POST', userId, conversationId, statusCode: 200, durationMs: Date.now() - startMs }))
  return Response.json(
    {
      conversationId,
      userMessageId,
      assistantMessageId,
      answer: result.answer,
      confidence: result.confidence,
      evidences: result.evidences,
      retrievalCount: result.retrievalCount,
    },
    { status: 200 },
  )
}
