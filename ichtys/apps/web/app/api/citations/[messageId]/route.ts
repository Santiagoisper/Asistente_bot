import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ messageId: string }>
}

/**
 * GET /api/citations/[messageId]?studyId=... - returns citation payload for an
 * assistant message after tenant and study validation.
 */
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { messageId } = await params
  const url = new URL(req.url)
  const parsed = query.safeParse({ studyId: url.searchParams.get('studyId') })

  if (!parsed.success || !z.string().uuid().safeParse(messageId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, study } = await validateStudyAccess(parsed.data.studyId)

    // TODO(RELEASE BLOCKER): Este guard es BLOQUEANTE para release: messageId
    // debe pertenecer al study activo.
    // const msg = await db.query.messages.findFirst({
    //   where: and(
    //     eq(messages.id, messageId),
    //     eq(messages.organizationId, orgId),
    //     eq(messages.studyId, study.id)
    //   )
    // })
    // if (!msg) return new Response('Not Found', { status: 404 })
    void orgId
    void study

    // TODO(paso-8): read citations WHERE message_id, organization_id, study_id;
    // audit citation.view.
    return Response.json({ messageId, citations: [] as const }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
