import { z } from 'zod'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ id: string; pageNumber: string }>
}

/**
 * GET /api/documents/[id]/page/[pageNumber]?studyId=... - serves a PDF page
 * through a short-lived signed URL after study access validation.
 */
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { id, pageNumber } = await params
  const url = new URL(req.url)
  const parsedQuery = query.safeParse({ studyId: url.searchParams.get('studyId') })
  const page = z.coerce.number().int().positive().safeParse(pageNumber)

  if (!parsedQuery.success || !page.success || !z.string().uuid().safeParse(id).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const ctx = await validateStudyAccess(parsedQuery.data.studyId)
    void ctx
    void id
    void page.data

    // TODO(paso-8): resolve document_version filtered by org+study, return a
    // short-lived Vercel Blob signed URL, and audit document.view.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    return handleApiError(err)
  }
}
