import { z } from 'zod'
import { handleApiError, validateDocumentVersionAccess } from '@ichtys/auth'
import { auditLogs, db } from '@ichtys/db'
import { getPrivateDocumentPdf } from './blob-download'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    documentVersionId: string
  }>
}

const paramsSchema = z.object({
  documentVersionId: z.string().uuid(),
})

function safeDownloadFileName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')

  const baseName = sanitized.length > 0 ? sanitized : 'document'
  return baseName.toLowerCase().endsWith('.pdf') ? baseName : `${baseName}.pdf`
}

function contentDispositionAttachment(fileName: string): string {
  return `attachment; filename="${fileName}"`
}

function requestHasBody(headers: Headers): boolean {
  const contentLength = headers.get('content-length')
  if (contentLength !== null && contentLength !== '0') return true
  if (headers.has('content-type')) return true
  return headers.has('transfer-encoding')
}

/**
 * GET /api/document-versions/[documentVersionId]/download
 *
 * Serves private PDFs only after Clerk auth and object-level authorization for
 * the requested document version. Blob identifiers are never returned to the
 * client.
 */
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    const url = new URL(req.url)
    if (
      url.searchParams.has('organization_id') ||
      url.searchParams.has('organizationId') ||
      requestHasBody(req.headers)
    ) {
      return new Response('Bad Request', { status: 400 })
    }

    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) {
      return new Response('Bad Request', { status: 400 })
    }

    const { userId, orgId, studyId, document, documentVersion } =
      await validateDocumentVersionAccess(params.data.documentVersionId)

    const fileName = safeDownloadFileName(document.name)
    const pdf = await getPrivateDocumentPdf(documentVersion.blobUrl)
    const inline = new URL(req.url).searchParams.get('inline') === '1'

    await db.insert(auditLogs).values({
      organizationId: orgId,
      studyId,
      userId,
      action: inline ? 'document.view' : 'document.download',
      resourceType: 'document_version',
      resourceId: documentVersion.id,
      metadata: {
        documentId: document.id,
        fileName,
      },
    })

    const disposition = inline
      ? `inline; filename="${fileName}"`
      : contentDispositionAttachment(fileName)

    const headers = new Headers({
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, no-store',
    })

    if (pdf.size !== null) {
      headers.set('Content-Length', String(pdf.size))
    }

    return new Response(pdf.stream, { status: 200, headers })
  } catch (err) {
    return handleApiError(err)
  }
}
