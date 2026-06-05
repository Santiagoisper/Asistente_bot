import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { runIngestionInput } from '@ichtys/ingestion'

export const runtime = 'nodejs'

// El cliente sólo provee study + documento; organization_id se resuelve server-side.
const triggerInput = runIngestionInput.omit({ organizationId: true })

/**
 * POST /api/ingestion/run — dispara (o reintenta) el pipeline de ingestion para
 * una versión de documento. Requiere rol de gestión documental.
 */
export async function POST(req: Request): Promise<Response> {
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
    const ctx = await validateStudyAccess(parsed.data.studyId, 'site_coordinator')

    // organization_id viene del contexto validado, no del request.
    const input = { ...parsed.data, organizationId: ctx.organizationId }
    void input

    // TODO(paso-5): runIngestion(input) en background + audit ingestion.start.
    return new Response('Not Implemented', { status: 501 })
  } catch (err) {
    if (err instanceof AccessError) {
      return new Response(err.message, { status: err.status })
    }
    console.error('ingestion run route error', err)
    return new Response('Internal Server Error', { status: 500 })
  }
}
