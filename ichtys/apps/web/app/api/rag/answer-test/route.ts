import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import {
  generateAnswerForStudy,
  AnswerOrchestratorError,
} from '../../../../lib/rag/answer-orchestrator'
import {
  clientIpRateLimitKey,
  enforceSlidingWindowRateLimit,
  rateLimitResponse,
} from '../../../../lib/security/rate-limit'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { answerTestInput } from '../../../../lib/api/input-schemas'

/**
 * POST /api/rag/answer-test — INTERNAL TESTING ENDPOINT
 *
 * Thin HTTP adapter over generateAnswerForStudy(). Intended for internal
 * integration testing of the RAG pipeline. NOT for production UI use.
 *
 * Protected by ENABLE_INTERNAL_RAG_ANSWER_TEST=true env var.
 * No persistence. No streaming. No citations written to DB.
 *
 * Pattern: feature-flag → reject-org-params → parse → wrapper → json
 */

export const runtime = 'nodejs'

// Org-identifier fields that must never come from the client.
const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

function hasOrgField(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return FORBIDDEN_ORG_FIELDS.some((field) => field in (body as Record<string, unknown>))
}

export async function POST(req: Request): Promise<Response> {
  // 1. Feature flag guard — must be explicitly enabled.
  if (process.env.ENABLE_INTERNAL_RAG_ANSWER_TEST !== 'true') {
    return new Response('Not Found', { status: 404 })
  }

  // 2. Reject org identifiers from query params.
  const url = new URL(req.url)
  for (const field of FORBIDDEN_ORG_FIELDS) {
    if (url.searchParams.has(field)) {
      return new Response('Bad Request', { status: 400 })
    }
  }

  const rateLimit = await enforceSlidingWindowRateLimit({
    key: `answer-test:${clientIpRateLimitKey(req)}`,
    limit: 20,
    windowSeconds: 60,
  })
  if (rateLimit.limited) {
    return rateLimitResponse(rateLimit.retryAfterSeconds)
  }

  // 3. Parse body — tope de bytes ANTES de parsear (413, H7 vuelta 2). El
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

  // 4. Explicit rejection of org fields before Zod (defense-in-depth).
  if (hasOrgField(body)) {
    return new Response('Bad Request', { status: 400 })
  }

  // 5. Zod validation (.strict() rejects any extra fields).
  const parsed = answerTestInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  // 6. Auth + study access (defense-in-depth). The wrapper re-validates, but
  //    this rejects unauthenticated / cross-tenant callers before any work.
  try {
    await validateStudyAccess(parsed.data.studyId)
  } catch (err) {
    return handleApiError(err)
  }

  // 7. Delegate to the server-only orchestration wrapper.
  try {
    const result = await generateAnswerForStudy(parsed.data)
    return Response.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof AnswerOrchestratorError) {
      if (err.code === 'access_denied') {
        return new Response('Study not found or access denied', { status: 403 })
      }
      return new Response('Internal Server Error', { status: 500 })
    }
    return handleApiError(err)
  }
}
