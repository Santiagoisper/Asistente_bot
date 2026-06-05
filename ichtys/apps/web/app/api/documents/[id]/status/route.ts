import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/status?studyId=... - ingestion pipeline status.
 */
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { id: documentId } = await params
  const url = new URL(req.url)
  const parsed = query.safeParse({ studyId: url.searchParams.get('studyId') })

  if (!parsed.success || !z.string().uuid().safeParse(documentId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, study } = await validateStudyAccess(parsed.data.studyId)

    // TODO(RELEASE BLOCKER): Este guard es BLOQUEANTE para release: sin él,
    // cualquier usuario autenticado puede enumerar estados de documentos de
    // otros studies de su org.
    // const doc = await db.query.documents.findFirst({
    //   where: and(
    //     eq(documents.id, documentId),
    //     eq(documents.organizationId, orgId),
    //     eq(documents.studyId, study.id)
    //   )
    // })
    // if (!doc) return new Response('Not Found', { status: 404 })
    void orgId
    void study

    // TODO(paso-4): read document_versions filtered by org+study+document.
    return Response.json({ documentId, status: 'processing' as const }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
