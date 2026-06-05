import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ id: string; pageNumber: string }>
}

/**
 * GET /api/documents/[id]/page/[pageNumber]?studyId=... — sirve una página del
 * PDF para el viewer.
 *
 * SECURITY.md: el binario nunca se expone con URL pública; se devuelve vía
 * signed URL de expiración corta tras validar acceso al study.
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

    // TODO(paso-8): resolver document_version (filtrado org+study) → signed URL
    // corta de Vercel Blob; audit document.view.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(err.message, { status: err.status })
    }
    console.error('document page route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
