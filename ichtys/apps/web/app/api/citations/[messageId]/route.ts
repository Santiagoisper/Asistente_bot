import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'

export const runtime = 'nodejs'

const query = z.object({ studyId: z.string().uuid() })

interface RouteContext {
  params: Promise<{ messageId: string }>
}

/**
 * GET /api/citations/[messageId]?studyId=... — devuelve el payload de citas de
 * un mensaje del assistant para el CitationPanel.
 *
 * Las citas se leen filtrando por org+study: nunca se devuelven citas de otro
 * tenant/estudio aunque el messageId fuese válido en otra org.
 *
 * Stub funcional: valida auth + study access y devuelve un array de citas vacío.
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
    void orgId
    void study

    // TODO(paso-8): leer citations WHERE message_id, organization_id, study_id;
    // audit citation.view.
    return Response.json({ messageId, citations: [] as const }, { status: 200 })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(err.message, { status: err.status })
    }
    console.error('citations route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
