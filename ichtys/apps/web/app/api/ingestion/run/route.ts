import { handleApiError, ROLES, validateStudyAccess } from '@ichtys/auth'
import { runIngestionInput } from '@ichtys/ingestion'

export const runtime = 'nodejs'

// The client only provides study + document; organization_id is server-side.
const triggerInput = runIngestionInput.omit({ organizationId: true })

/**
 * POST /api/ingestion/run - trigger or retry ingestion for a document version.
 * Requires org_admin.
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
    const { orgId } = await validateStudyAccess(parsed.data.studyId, ROLES.ORG_ADMIN)

    const input = { ...parsed.data, organizationId: orgId }
    void input

    // TODO(paso-5): runIngestion(input) in background + audit ingestion.start.
    return Response.json(
      { documentVersionId: parsed.data.documentVersionId, status: 'queued' as const },
      { status: 202 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
