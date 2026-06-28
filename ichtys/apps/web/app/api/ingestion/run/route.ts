import { after } from 'next/server'
import { z } from 'zod'
import { handleApiError, validateDocumentVersionAccess } from '@ichtys/auth'
import { runIngestion } from '@ichtys/ingestion'

export const runtime = 'nodejs'
// Ingestion + spec extraction para un protocolo de 200+ páginas toma ~60-120s.
// Vercel Pro soporta hasta 300s. El after() callback hereda este maxDuration.
export const maxDuration = 300

const triggerInput = z
  .object({
    documentVersionId: z.string().uuid(),
  })
  .strict()

/**
 * POST /api/ingestion/run — dispara ingestion para un document version.
 *
 * Usa after() de Next.js 15 para retornar 202 de inmediato y correr la
 * ingestion en background. Esto resuelve el problema de "Lambda killed by
 * client disconnect" — el trabajo continúa aunque el cliente navegue o cierre.
 *
 * Sin after(): el Lambda vive mientras el cliente mantiene la conexión TCP.
 * Con after(): el Lambda vive hasta que after() completa (hasta maxDuration).
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (url.searchParams.has('organization_id') || url.searchParams.has('organizationId')) {
    return new Response('Bad Request', { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = triggerInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { userId, orgId, studyId, document, documentVersion } =
      await validateDocumentVersionAccess(parsed.data.documentVersionId)

    // Encolar el trabajo en background. after() garantiza que el Lambda
    // continúa corriendo después de que la respuesta HTTP es enviada —
    // incluso si el cliente desconecta antes de que termine.
    after(async () => {
      try {
        await runIngestion({
          userId,
          orgId,
          studyId,
          documentId: document.id,
          documentVersionId: documentVersion.id,
        })
      } catch (err) {
        console.error('[ingestion/run] after() error:', err)
      }
    })

    // Retornar inmediatamente — el cliente no necesita esperar el resultado.
    return Response.json(
      {
        documentId: document.id,
        documentVersionId: documentVersion.id,
        status: 'processing',
      },
      { status: 202 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
