import { z } from 'zod'
import { handleApiError, validateMessageAccess } from '@ichtys/auth'
import { db } from '@ichtys/db'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ messageId: string }>
}

/**
 * GET /api/citations/[messageId] - returns citation payload for an assistant
 * message after tenant, study, and object-level validation.
 */
export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { messageId } = await params

  if (!z.string().uuid().safeParse(messageId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, studyId } = await validateMessageAccess(messageId)

    const rows = await db.query.citations.findMany({
      where: (citation, { and, eq }) =>
        and(
          eq(citation.messageId, messageId),
          eq(citation.organizationId, orgId),
          eq(citation.studyId, studyId),
        ),
    })

    // TODO(paso-8): audit citation.view.
    return Response.json({ messageId, citations: rows }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
