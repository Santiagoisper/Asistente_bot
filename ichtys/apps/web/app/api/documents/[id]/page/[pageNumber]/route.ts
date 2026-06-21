import { z } from 'zod'
import { handleApiError, validateDocumentPageAccess } from '@ichtys/auth'

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
    void ctx

    // TODO(paso-8): resolve signed URL for the validated page and audit
    // document.view.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    return handleApiError(err)
  }
}
