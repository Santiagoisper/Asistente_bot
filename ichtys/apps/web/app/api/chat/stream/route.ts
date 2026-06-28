import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { retrieveRelevantChunks, answerEngineStream } from '@ichtys/rag'
import { getOrgRagConfig } from '@ichtys/db'
import type { AnswerStreamEvent } from '@ichtys/rag'
import {
  generateAndPersistConversationTitle,
  getOrCreateConversation,
  loadConversationHistory,
  persistAssistantMessageAndCitations,
  persistUserMessage,
  writeAuditLog,
} from '../../../../lib/chat/persistence'
import {
  enforceSlidingWindowRateLimit,
  getChatRateLimitConfig,
  rateLimitResponse,
} from '../../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../../lib/observability/logger'
import { expandShortQueryForRetrieval } from '../../../../lib/rag/query-expander'
import { getSpecContextChunks } from '../../../../lib/rag/spec-context'
import { annotateAnswerSync } from '@ichtys/rag/medical-annotator'
import type { Confidence } from '@ichtys/rag'
import type { Evidence } from '@ichtys/rag'

/**
 * POST /api/chat/stream -- streaming variant of /api/chat.
 *
 * Returns SSE (text/event-stream) with frames:
 *   data: {"type":"start","conversationId":"...","userMessageId":"..."}\n\n
 *   data: {"type":"token","text":"..."}\n\n          (one per LLM token chunk)
 *   data: {"type":"done",...full metadata...}\n\n
 *   data: {"type":"error"}\n\n                       (on unrecoverable failure)
 *
 * Auth, rate limiting, validation identical to POST /api/chat.
 * orgId resolved from Clerk token -- never from body/query/headers.
 */

export const runtime = 'nodejs'

const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

const documentTypeEnum = z.enum([
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
])

const chatStreamInput = z
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
  return FORBIDDEN_ORG_FIELDS.some((f) => f in (body as Record<string, unknown>))
}

function sseEncode(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`)
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/chat/stream', method: 'POST' }))

  // 1. Block org fields from query params.
  const url = new URL(req.url)
  for (const field of FORBIDDEN_ORG_FIELDS) {
    if (url.searchParams.has(field)) return new Response('Bad Request', { status: 400 })
  }

  // 2. Parse body.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  if (hasOrgField(body)) return new Response('Bad Request', { status: 400 })

  // 3. Validate input.
  const parsed = chatStreamInput.safeParse(body)
  if (!parsed.success) return new Response('Bad Request', { status: 400 })

  const { studyId, question, conversationId: inputConversationId, documentType, topK } = parsed.data

  // 4. Auth -- orgId from Clerk token.
  let userId: string
  let orgId: string
  let studyName: string | null = null
  let protocolNumber: string | null = null
  try {
    const ctx = await validateStudyAccess(studyId)
    userId = ctx.userId
    orgId = ctx.orgId
    studyName = ctx.study.name
    protocolNumber = ctx.study.protocolNumber
  } catch (err) {
    return handleApiError(err)
  }

  // 5. Rate limit.
  const chatRlConfig = getChatRateLimitConfig()
  const rateLimit = await enforceSlidingWindowRateLimit({
    key: `chat:${userId}:${studyId}`,
    limit: chatRlConfig.limit,
    windowSeconds: chatRlConfig.windowSeconds,
  })
  if (rateLimit.limited) {
    log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/chat/stream', method: 'POST', userId, statusCode: 429 }))
    return rateLimitResponse(rateLimit.retryAfterSeconds)
  }

  // 6. Get or create conversation.
  let conversationId: string
  try {
    conversationId = await getOrCreateConversation({ conversationId: inputConversationId, orgId, studyId, userId })
  } catch (err) {
    return handleApiError(err)
  }

  // 7. Load conversation history.
  let conversationHistory: Awaited<ReturnType<typeof loadConversationHistory>>
  try {
    conversationHistory = await loadConversationHistory({ conversationId, orgId, studyId })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 8. Persist user message before streaming starts.
  let userMessageId: string
  try {
    userMessageId = await persistUserMessage({ conversationId, orgId, studyId, question })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 9. Audit -- requested.
  try {
    await writeAuditLog({
      action: 'rag.answer.requested',
      orgId,
      studyId,
      userId,
      resourceType: 'conversation',
      resourceId: conversationId,
      metadata: { documentType: documentType ?? null, topK: topK ?? null, historyTurns: conversationHistory.length, streaming: true },
    })
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  // 9b. Load org RAG config (threshold + topK) — falls back to system defaults.
  const orgRagConfig = await getOrgRagConfig(orgId).catch(() => null)

  // 10. Kick off auto-title for new conversations (fire-and-forget, non-blocking).
  //     Haiku + 6-word title ≈ 300-500 ms — will resolve before the LLM stream ends.
  //     If it fails, title stays null and we swallow the error.
  const isNewConversation = !inputConversationId
  const titlePromise: Promise<string | null> = isNewConversation
    ? generateAndPersistConversationTitle({ conversationId, question, studyName }).catch(() => null)
    : Promise.resolve(null)

  // 11. Return SSE stream.
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: Record<string, unknown>) => controller.enqueue(sseEncode(obj))

      // Emit start frame immediately so the client can bind the IDs.
      enqueue({ type: 'start', conversationId, userMessageId })

      let retrievalCount = 0
      let fullAnswer = ''
      let finalConfidence: Confidence = 'insufficient_evidence'
      let finalEvidences: Evidence[] = []

      try {
        // 10a. Retrieval.
        const retrievalQuery = expandShortQueryForRetrieval({ question, studyName, protocolNumber })
        console.log(`[stream:${requestId}] starting retrieval`)
        const [retrievedChunks, specContext] = await Promise.all([
          retrieveRelevantChunks({
            queryText: retrievalQuery,
            orgId,
            studyId,
            topK: topK ?? orgRagConfig?.topK ?? 20,
            documentType,
          }),
          // Inyección de spec: si el intent de la pregunta es claro, prepend
          // el spec estructurado como virtual chunks con score=1.0.
          // Corre en paralelo con el retrieval — no agrega latencia.
          getSpecContextChunks({ question, orgId, studyId }),
        ])

        // Spec chunks van PRIMERO: el LLM los ve como [1], [2], etc.
        // El conocimiento estructurado tiene prioridad sobre el texto raw.
        const allChunks = [...specContext.chunks, ...retrievedChunks]

        console.log(
          `[stream:${requestId}] retrieval done — ${retrievedChunks.length} chunks ` +
          `+ ${specContext.chunks.length} spec chunks (intent: ${specContext.specFound ? 'matched' : 'none'})`,
        )
        retrievalCount = allChunks.length

        // 10b. Stream LLM answer.
        const eventGen: AsyncGenerator<AnswerStreamEvent> = answerEngineStream({
          question,
          retrievedChunks: allChunks,
          conversationHistory,
          similarityThreshold: orgRagConfig?.similarityThreshold,
        })

        for await (const event of eventGen) {
          if (event.type === 'token') {
            fullAnswer += event.text
            enqueue({ type: 'token', text: event.text })
          } else {
            finalConfidence = event.confidence
            finalEvidences = event.evidences
            fullAnswer = event.fullAnswer
          }
        }

        // 10c. Medical annotations — run BEFORE persist so they are stored together.
        //      Dictionary scan is < 2 ms, no I/O. Skip for insufficient_evidence.
        const annotations =
          fullAnswer && finalConfidence !== 'insufficient_evidence'
            ? annotateAnswerSync(fullAnswer)
            : []

        // 10d. Strip synthetic spec-chunk evidences before DB persistence.
        //      Spec chunks have chunkId "spec:${specId}:${section}" — not real UUIDs.
        //      Passing them to the citations table crashes with "invalid input syntax
        //      for type uuid". Still emitted to client via done frame for UI display.
        const persistableEvidences = finalEvidences.filter(
          (e) => !e.chunkId.startsWith('spec:'),
        )

        // 10e. Persist assistant message + citations + annotations atomically.
        const assistantMessageId = await persistAssistantMessageAndCitations({
          conversationId,
          orgId,
          studyId,
          answer: fullAnswer,
          confidence: finalConfidence,
          evidences: persistableEvidences,
          annotations: annotations.length > 0 ? annotations : undefined,
        })

        // 10e. Audit -- completed.
        await writeAuditLog({
          action: 'rag.answer.completed',
          orgId,
          studyId,
          userId,
          resourceType: 'conversation',
          resourceId: conversationId,
          metadata: { confidence: finalConfidence, evidenceCount: finalEvidences.length, retrievalCount, annotationCount: annotations.length, streaming: true },
        }).catch(() => {/* non-critical */})

        log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/chat/stream', method: 'POST', userId, conversationId, statusCode: 200 }))

        // 10f. Done frame.
        enqueue({
          type: 'done',
          assistantMessageId,
          confidence: finalConfidence,
          evidences: finalEvidences,
          retrievalCount,
          conversationId,
        })

        // 10g. Annotation frame — emitted after done so client has the messageId bound.
        if (annotations.length > 0) {
          enqueue({ type: 'annotations', annotations })
        }

        // 10h. Title frame — only for new conversations. titlePromise started before
        //      the stream loop, so Haiku has been running concurrently; await here
        //      is nearly instant in the happy path.
        if (isNewConversation) {
          const title = await titlePromise
          if (title) {
            enqueue({ type: 'title', conversationId, title })
          }
        }
      } catch (err) {
        console.error('[POST /api/chat/stream] error:', err)
        enqueue({ type: 'error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  })
}
