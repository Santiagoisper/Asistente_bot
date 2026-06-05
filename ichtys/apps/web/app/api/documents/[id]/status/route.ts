import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/status?studyId=... — estado del pipeline de ingestion
 * para una versión de documento (pending | processing | ready | error).
 * Usado por el frontend para polling (ARCHITECTURE.md).
 */
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params
  const url = new URL(req.url)
  const parsed = query.safeParse({ studyId: url.searchParams.get('studyId') })

  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const ctx = await validateStudyAccess(parsed.data.studyId)
    void ctx
    void id

    // TODO(paso-4): leer document_versions filtrando org+study+document; 404 si no.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(err.message, { status: err.status })
    }
    console.error('status route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
