import { z } from 'zod'
import { AccessError, handleApiError, validateMessageAccess } from '@ichtys/auth'
import { auditLogs, db } from '@ichtys/db'
import { getMessageCitations } from '../../../../lib/chat/history'
import {
  enforceSlidingWindowRateLimit,
  getCitationsRateLimitConfig,
  rateLimitResponse,
} from '../../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../../lib/observability/logger'

/**
 * GET /api/citations/[messageId]
 *
 * Returns citation payload for an assistant message after full tenant,
 * object-level, and user-level validation.
 */

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ messageId: string }>
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  const startMs = Date.now()
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/citations/[messageId]', method: 'GET' }))

  const { messageId } = await params

  if (!z.string().uuid().safeParse(messageId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { userId, orgId, studyId, message } = await validateMessageAccess(messageId)

    const citationsRlConfig = getCitationsRateLimitConfig()
    const rateLimit = await enforceSlidingWindowRateLimit({
      key: `citations:${userId}:${orgId}`,
      limit: citationsRlConfig.limit,
      windowSeconds: citationsRlConfig.windowSeconds,
    })
    if (rateLimit.limited) {
      log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/citations/[messageId]', method: 'GET', userId, messageId, statusCode: 429 }))
      return rateLimitResponse(rateLimit.retryAfterSeconds)
    }

    const conv = await db.query.conversations.findFirst({
      where: (c, { and, eq }) =>
        and(
          eq(c.id, message.conversationId),
          eq(c.userId, userId),
          eq(c.organizationId, orgId),
        ),
    })

    if (!conv) {
      throw new AccessError('Conversation not found or access denied', 404)
    }

    const citations = await getMessageCitations(messageId, orgId, studyId)

    await db.insert(auditLogs).values({
      action: 'citation.view',
      organizationId: orgId,
      studyId,
      userId,
      resourceType: 'message',
      resourceId: messageId,
      metadata: { citationCount: citations.length },
    })

    log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/citations/[messageId]', method: 'GET', userId, messageId, studyId, statusCode: 200, durationMs: Date.now() - startMs }))
    return Response.json({ messageId, citations }, { status: 200 })
  } catch (err) {
    log(makeRecord({ requestId, level: 'error', event: 'api.request.failed', endpoint: '/api/citations/[messageId]', method: 'GET', durationMs: Date.now() - startMs }))
    return handleApiError(err)
  }
}
