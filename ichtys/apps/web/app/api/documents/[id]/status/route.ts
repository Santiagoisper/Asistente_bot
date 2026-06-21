import { z } from 'zod'
import { handleApiError, validateDocumentAccess } from '@ichtys/auth'
import { db } from '@ichtys/db'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/status - ingestion pipeline status.
 */
export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { id: documentId } = await params

  if (!z.string().uuid().safeParse(documentId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, studyId, document } = await validateDocumentAccess(documentId)

    const latestVersion = await db.query.documentVersions.findFirst({
      where: (version, { and, eq }) =>
        and(
          eq(version.documentId, document.id),
          eq(version.organizationId, orgId),
          eq(version.studyId, studyId),
        ),
      orderBy: (version, { desc }) => [desc(version.versionNumber), desc(version.createdAt)],
    })

    if (!latestVersion) {
      throw new Error('Authorized document has no document version')
    }

    return Response.json(
      {
        documentId: document.id,
        latestDocumentVersionId: latestVersion.id,
        status: latestVersion.status,
        pageCount: latestVersion.pageCount,
        errorMessage: latestVersion.status === 'error' ? latestVersion.errorMessage : null,
        createdAt: latestVersion.createdAt,
      },
      { status: 200 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
