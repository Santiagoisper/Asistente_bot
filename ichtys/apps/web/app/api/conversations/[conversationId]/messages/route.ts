import { z } from 'zod'
import { handleApiError, validateConversationAccess } from '@ichtys/auth'
import { getConversationMessages } from '../../../../../lib/chat/history'

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
    const { orgId, studyId } = await validateConversationAccess(conversationId)
    const messages = await getConversationMessages(conversationId, orgId, studyId)

    return Response.json(
      {
        conversationId,
        studyId,
        messages,
      },
      { status: 200 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
