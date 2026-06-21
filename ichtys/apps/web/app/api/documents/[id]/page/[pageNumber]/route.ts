import { z } from 'zod'
import { handleApiError, validateDocumentPageAccess } from '@ichtys/auth'
import { auditLogs, db } from '@ichtys/db'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string; pageNumber: string }>
}

/**
 * GET /api/documents/[id]/page/[pageNumber] - serves a PDF page through a
 * short-lived signed URL after object-level validation.
 */
export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { id, pageNumber } = await params
  const page = z.coerce.number().int().positive().safeParse(pageNumber)

  if (!page.success || !z.string().uuid().safeParse(id).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const ctx = await validateDocumentPageAccess(id, page.data)
    const inlineUrl =
      `/api/document-versions/${encodeURIComponent(ctx.documentVersion.id)}/download` +
      `?inline=1#page=${ctx.page.pageNumber}`

    await db.insert(auditLogs).values({
      organizationId: ctx.orgId,
      studyId: ctx.studyId,
      userId: ctx.userId,
      action: 'document.view',
      resourceType: 'page',
      resourceId: `${ctx.document.id}:${ctx.page.pageNumber}`,
      metadata: {
        documentId: ctx.document.id,
        documentVersionId: ctx.documentVersion.id,
        pageNumber: ctx.page.pageNumber,
      },
    })

    return Response.json(
      {
        documentId: ctx.document.id,
        documentVersionId: ctx.documentVersion.id,
        pageNumber: ctx.page.pageNumber,
        openUrl: inlineUrl,
      },
      { status: 200 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
