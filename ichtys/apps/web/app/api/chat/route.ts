import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import {
  generateAnswerForStudy,
} from '../../../lib/rag/answer-orchestrator'
import {
  getOrCreateConversation,
  persistAssistantMessageAndCitations,
  persistUserMessage,
  writeAuditLog,
} from '../../../lib/chat/persistence'
import {
  enforceSlidingWindowRateLimit,
  getChatRateLimitConfig,
  rateLimitResponse,
} from '../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../lib/observability/logger'

/**
 * POST /api/chat — grounded answer engine with full chat persistence.
 *
 * Flow:
 *   auth → study access → conversation → user message → rag.answer.requested
 *   → generateAnswerForStudy → assistant message + citations → rag.answer.completed
 *
 * Rules (CLAUDE.md, SECURITY.md):
 *  - orgId always from Clerk token — never from body or query params.
 *  - studyId validated against active org before any RAG operation.
 *  - No prompts, embeddings, chunks or PHI in logs or responses.
 *  - Audit log writes are mandatory for rag.answer.* events.
 *  - No streaming in this phase. No UI. No PDF viewer.
 */

export const runtime = 'nodejs'

const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

// Defined locally to avoid loading the DB client during test module resolution.
const documentTypeEnum = z.enum([
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
])

const chatInput = z
  .object({
    studyId: z.string().uuid(),
    question: z.string().min(1),
    conversationId: z.string().uuid().optional(),
    documentType: documentTypeEnum.optional(),
    topK: z.number().int().positive().max(20).optional(),
  })
  .strict()

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

  // 2. Parse body.
  let body: unknown
  try {
    body = await req.json()
  } catch {
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
    key: `chat:${userId}:${studyId}`,
    limit: chatRlConfig.limit,
    windowSeconds: chatRlConfig.windowSeconds,
  })
  if (rateLimit.limited) {
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

  // 7. Persist user message.
  let userMessageId: string
  try {
    userMessageId = await persistUserMessage({ conversationId, orgId, studyId, question })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 8. Audit — requested. Best-effort, safe metadata only (no question text / PHI).
  try {
    await writeAuditLog({
      action: 'rag.answer.requested',
      orgId,
      studyId,
      userId,
      resourceType: 'conversation',
      resourceId: conversationId,
      metadata: {
        documentType: documentType ?? null,
        topK: topK ?? null,
      },
    })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 9. RAG wrapper — retrieval + answer engine.
  let result: Awaited<ReturnType<typeof generateAnswerForStudy>>
  try {
    result = await generateAnswerForStudy({ studyId, question, documentType, topK })
  } catch {
    try {
      await writeAuditLog({
        action: 'rag.answer.failed',
        orgId,
        studyId,
        userId,
        resourceType: 'conversation',
        resourceId: conversationId,
        metadata: { error: 'wrapper_error' },
      })
    } catch {
      return new Response('Internal Server Error', { status: 500 })
    }
    return new Response('Internal Server Error', { status: 500 })
  }

  // 10. Persist assistant message + citations atomically.
  let assistantMessageId: string
  try {
    assistantMessageId = await persistAssistantMessageAndCitations({
      conversationId,
      orgId,
      studyId,
      answer: result.answer,
      confidence: result.confidence,
      evidences: result.evidences,
    })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 11. Audit — completed. Best-effort, safe metadata only.
  try {
    await writeAuditLog({
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
    })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 12. Return structured response — no prompts, embeddings or raw chunks.
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
