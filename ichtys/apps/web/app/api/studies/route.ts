import { auth } from '@clerk/nextjs/server'
import { db, studies } from '@ichtys/db'
import { canAdministerStudy, handleApiError, normalizeRole, resolveOrProvisionOrganization } from '@ichtys/auth'
import { JsonBodyTooLargeError, readJsonBody } from '../../../lib/api/body-limit'
import { createStudyInput } from '../../../lib/api/input-schemas'
import { safeWriteAuditLog } from '../../../lib/chat/persistence'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) {
    return new Response('Unauthorized', { status: 401 })
  }
  // Crear un estudio es administrar el estudio: el coordinador sube documentos, no abre estudios.
  if (!canAdministerStudy(normalizeRole(orgRole))) {
    return new Response('Forbidden', { status: 403 })
  }

  // Tope de bytes ANTES de parsear (413, H7 vuelta 2). El auth ya corrió
  // más arriba.
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    if (err instanceof JsonBodyTooLargeError) {
      return new Response('Payload Too Large', { status: 413 })
    }
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = createStudyInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const org = await resolveOrProvisionOrganization(clerkOrgId)
    if (!org) throw new Error('Failed to provision organization')

    const [study] = await db
      .insert(studies)
      .values({
        organizationId: org.id,
        name: parsed.data.name,
        protocolNumber: parsed.data.protocolNumber ?? null,
        status: 'active',
      })
      .returning()

    if (!study) throw new Error('Insert did not return a row')

    // Abrir un estudio queda registrado: quién, cuándo y en qué organización.
    // El nombre del estudio no va al registro. Si el registro falla no se
    // devuelve error: el estudio ya existe y un reintento lo duplicaría.
    await safeWriteAuditLog({
      action: 'study.create',
      orgId: org.id,
      studyId: study.id,
      userId,
      resourceType: 'study',
      resourceId: study.id,
      metadata: { hasProtocolNumber: study.protocolNumber !== null },
    })

    return Response.json(
      { id: study.id, name: study.name, protocolNumber: study.protocolNumber, status: study.status },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
