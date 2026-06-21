import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { listConversationsForStudy } from '../../../lib/chat/history'
import {
  enforceSlidingWindowRateLimit,
  getHistoryRateLimitConfig,
  rateLimitResponse,
} from '../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../lib/observability/logger'

/**
 * GET /api/conversations?studyId=... — lists conversations for the active user
 * within an authorized study.
 *
 * Auth chain: Clerk token → orgId → validateStudyAccess(studyId) → userId
 * Query filter: organizationId + studyId + userId applied in SQL.
 */

export const runtime = 'nodejs'

const FORBIDDEN_ORG_FIELDS = ['orgId', 'organizationId', 'organization_id'] as const

export async function GET(req: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  const startMs = Date.now()
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/conversations', method: 'GET' }))

  const url = new URL(req.url)

  // Reject org identifiers from query params.
  for (const field of FORBIDDEN_ORG_FIELDS) {
    if (url.searchParams.has(field)) {
      return new Response('Bad Request', { status: 400 })
    }
  }

  const studyIdRaw = url.searchParams.get('studyId')
  if (!studyIdRaw) {
    return new Response('Bad Request', { status: 400 })
  }

  const studyIdParsed = z.string().uuid().safeParse(studyIdRaw)
  if (!studyIdParsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  const studyId = studyIdParsed.data

  try {
    const { userId, orgId } = await validateStudyAccess(studyId)

    const historyRlConfig = getHistoryRateLimitConfig()
    const rateLimit = await enforceSlidingWindowRateLimit({
      key: `history:${userId}:${orgId}`,
      limit: historyRlConfig.limit,
      windowSeconds: historyRlConfig.windowSeconds,
    })
    if (rateLimit.limited) {
      log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/conversations', method: 'GET', userId, studyId, statusCode: 429 }))
      return rateLimitResponse(rateLimit.retryAfterSeconds)
    }

    const conversations = await listConversationsForStudy(orgId, studyId, userId)
    log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/conversations', method: 'GET', userId, studyId, statusCode: 200, durationMs: Date.now() - startMs }))
    return Response.json({ conversations }, { status: 200 })
  } catch (err) {
    log(makeRecord({ requestId, level: 'error', event: 'api.request.failed', endpoint: '/api/conversations', method: 'GET', durationMs: Date.now() - startMs }))
    return handleApiError(err)
  }
}
