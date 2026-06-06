import { z } from 'zod'
import { handleApiError, validateDocumentAccess } from '@ichtys/auth'

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
    void orgId
    void studyId
    void document

    // TODO(paso-4): read document_versions filtered by org+study+document.
    return Response.json({ documentId, status: 'processing' as const }, { status: 200 })
  } catch (err) {
    return handleApiError(err)
  }
}
