import { z } from 'zod'
import { AccessError, handleApiError, validateMessageAccess } from '@ichtys/auth'
import { auditLogs, db } from '@ichtys/db'
import { getMessageCitations } from '../../../../lib/chat/history'

/**
 * GET /api/citations/[messageId]
 *
 * Returns citation payload for an assistant message after full tenant,
 * object-level, and user-level validation.
 *
 * Auth chain: messageId → organizationId + studyId (validateMessageAccess) →
 * conversationId → userId (conversation ownership check) → citations.
 *
 * SECURITY.md §16: validation traverses the full chain
 * messageId → conversationId → organizationId + studyId + userId.
 */

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ messageId: string }>
}

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { messageId } = await params

  if (!z.string().uuid().safeParse(messageId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { userId, orgId, studyId, message } = await validateMessageAccess(messageId)

    // Validate userId through conversation chain — ensures users only see their own citations.
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

    // Audit citation.view — best-effort, never aborts the response.
    db.insert(auditLogs)
      .values({
        action: 'citation.view',
        organizationId: orgId,
        studyId,
        userId,
        resourceType: 'message',
        resourceId: messageId,
        metadata: { citationCount: citations.length },
      })
      .catch(() => {
        // Best-effort — audit failure must not block the response.
      })

    return Response.json({ messageId, citations }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
