import { z } from 'zod'
import { handleApiError, validateConversationAccess } from '@ichtys/auth'
import { getConversationMessages } from '../../../../../lib/chat/history'
import {
  enforceSlidingWindowRateLimit,
  getHistoryRateLimitConfig,
  rateLimitResponse,
} from '../../../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../../../lib/observability/logger'

/**
 * GET /api/conversations/[conversationId]/messages
 *
 * Returns messages for an authorized conversation in ascending createdAt order.
 *
 * Auth chain: Clerk → orgId + userId → conversation (orgId + userId match) →
 * studyId → messages filtered by conversationId + orgId + studyId in SQL.
 */

export const runtime = 'nodejs'

const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

interface RouteContext {
  params: Promise<{ conversationId: string }>
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  const startMs = Date.now()
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/conversations/[conversationId]/messages', method: 'GET' }))

  const url = new URL(req.url)

  // Reject org identifiers from query params.
  for (const field of FORBIDDEN_ORG_FIELDS) {
    if (url.searchParams.has(field)) {
      return new Response('Bad Request', { status: 400 })
    }
  }

  const { conversationId } = await params

  if (!z.string().uuid().safeParse(conversationId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { userId, orgId, studyId } = await validateConversationAccess(conversationId)

    const historyRlConfig = getHistoryRateLimitConfig()
    const rateLimit = await enforceSlidingWindowRateLimit({
      key: `history:${userId}:${orgId}`,
      limit: historyRlConfig.limit,
      windowSeconds: historyRlConfig.windowSeconds,
    })
    if (rateLimit.limited) {
      log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/conversations/[conversationId]/messages', method: 'GET', userId, conversationId, statusCode: 429 }))
      return rateLimitResponse(rateLimit.retryAfterSeconds)
    }

    const messages = await getConversationMessages(conversationId, orgId, studyId)
    log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/conversations/[conversationId]/messages', method: 'GET', userId, conversationId, studyId, statusCode: 200, durationMs: Date.now() - startMs }))
    return Response.json(
      {
        conversationId,
        studyId,
        messages,
      },
      { status: 200 },
    )
  } catch (err) {
    log(makeRecord({ requestId, level: 'error', event: 'api.request.failed', endpoint: '/api/conversations/[conversationId]/messages', method: 'GET', durationMs: Date.now() - startMs }))
    return handleApiError(err)
  }
}
