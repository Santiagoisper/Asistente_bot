import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { listConversationsForStudy } from '../../../lib/chat/history'

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
    const conversations = await listConversationsForStudy(orgId, studyId, userId)
    return Response.json({ conversations }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
