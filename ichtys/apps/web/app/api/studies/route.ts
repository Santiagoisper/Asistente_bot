import { auth } from '@clerk/nextjs/server'
import { auditLogs, db, studies } from '@ichtys/db'
import { canAdministerStudy, handleApiError, normalizeRole, resolveOrProvisionOrganization } from '@ichtys/auth'
import { JsonBodyTooLargeError, readJsonBody } from '../../../lib/api/body-limit'
import { createStudyInput } from '../../../lib/api/input-schemas'

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

    // El alta y su registro de auditoría van en la misma transacción
    // (docs/decisions/audit-policy.md): o quedan los dos, o ninguno. Si el
    // registro falla, el estudio no existe y reintentar no lo duplica.
    // El nombre del estudio no va al registro.
    const study = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(studies)
        .values({
          organizationId: org.id,
          name: parsed.data.name,
          protocolNumber: parsed.data.protocolNumber ?? null,
          status: 'active',
        })
        .returning()
      if (!created) throw new Error('Insert did not return a row')

      await tx.insert(auditLogs).values({
        action: 'study.create',
        organizationId: org.id,
        studyId: created.id,
        userId,
        resourceType: 'study',
        resourceId: created.id,
        metadata: { hasProtocolNumber: created.protocolNumber !== null },
      })
      return created
    })

    return Response.json(
      { id: study.id, name: study.name, protocolNumber: study.protocolNumber, status: study.status },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
