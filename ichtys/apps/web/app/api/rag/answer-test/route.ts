import { z } from 'zod'
import { handleApiError } from '@ichtys/auth'
import {
  generateAnswerForStudy,
  AnswerOrchestratorError,
} from '../../../../lib/rag/answer-orchestrator'
import {
  clientIpRateLimitKey,
  enforceSlidingWindowRateLimit,
  rateLimitResponse,
} from '../../../../lib/security/rate-limit'

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

// Mirrors packages/db/schema/enums.ts — defined locally to avoid loading the
// DB client (which requires DATABASE_URL) during module resolution in tests.
const documentTypeEnum = z.enum([
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
])

const answerTestInput = z
  .object({
    studyId: z.string().uuid(),
    question: z.string().min(1),
    documentType: documentTypeEnum.optional(),
    topK: z.number().int().positive().max(20).optional(),
  })
  .strict()

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

  // 3. Parse body.
  let body: unknown
  try {
    body = await req.json()
  } catch {
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

  // 6. Delegate to the server-only orchestration wrapper.
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
