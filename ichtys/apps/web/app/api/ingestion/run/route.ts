import { z } from 'zod'
import { handleApiError, validateDocumentVersionAccess } from '@ichtys/auth'
import { runIngestion } from '@ichtys/ingestion'

export const runtime = 'nodejs'
// Ingestion + spec extraction para un protocolo de 200+ páginas toma ~60-120s.
// Vercel Pro soporta hasta 300s. Sin este valor el Lambda muere a los 10s default.
export const maxDuration = 300

const triggerInput = z
  .object({
    documentVersionId: z.string().uuid(),
  })
  .strict()

/**
 * POST /api/ingestion/run - trigger or retry ingestion for a document version.
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

    const result = await runIngestion({
      userId,
      orgId,
      studyId,
      documentId: document.id,
      documentVersionId: documentVersion.id,
    })

    return Response.json(
      {
        documentId: result.documentId,
        documentVersionId: result.documentVersionId,
        status: result.status,
      },
      { status: 202 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
