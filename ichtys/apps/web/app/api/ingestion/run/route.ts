import { after } from 'next/server'
import { AccessError, canManageDocuments, handleApiError, validateDocumentVersionAccess } from '@ichtys/auth'
import { runIngestion } from '@ichtys/ingestion'
import {
  enforceSlidingWindowRateLimit,
  getIngestionRateLimitConfig,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from '../../../../lib/security/rate-limit'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { triggerInput } from '../../../../lib/api/input-schemas'

export const runtime = 'nodejs'
// Ingestion + spec extraction para un protocolo de 200+ páginas toma ~60-120s.
// Vercel Pro soporta hasta 300s. El after() callback hereda este maxDuration.
export const maxDuration = 300

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

  // Tope de bytes ANTES de parsear (413, H7 vuelta 2). El
  // documentVersionId viene del body, así que el auth no puede adelantarse:
  // el corte por bytes es la barrera barata de esta ruta.
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) {
      return new Response('Payload Too Large', { status: 413 })
    }
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = triggerInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const access = await validateDocumentVersionAccess(parsed.data.documentVersionId)
    if (!canManageDocuments(access.role)) {
      throw new AccessError('Forbidden', 403)
    }
    const { userId, orgId, studyId, document, documentVersion } = access

    // Tope de gasto: cada POST re-lanza la extracción de spec con Opus (~60-120 s) y el
    // cliente puede repetirlo. Sin esto era un bypass del tope de /spec/reextract.
    const rlConfig = getIngestionRateLimitConfig()
    const rateLimit = await enforceSlidingWindowRateLimit({
      key: `ingestion:${orgId}:${userId}:${documentVersion.id}`,
      limit: rlConfig.limit,
      windowSeconds: rlConfig.windowSeconds,
    })
    if (rateLimit.limited) {
      return rateLimit.reason === 'unavailable'
        ? rateLimitUnavailableResponse()
        : rateLimitResponse(rateLimit.retryAfterSeconds)
    }

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
      } catch {
        console.error('[ingestion/run] after() error', { code: 'ingestion_failed' })
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
