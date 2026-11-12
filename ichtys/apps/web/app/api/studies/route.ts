import { auth } from '@clerk/nextjs/server'
import { auditLogs, db, studies, studyMemberships } from '@ichtys/db'
import { canAdministerStudy, handleApiError, normalizeRole, resolveOrProvisionOrganization } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import { allows, type AccessSubject } from '@ichtys/auth/functions'
import { JsonBodyTooLargeError, readJsonBody } from '../../../lib/api/body-limit'
import { createStudyInput } from '../../../lib/api/input-schemas'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) {
    return new Response('Unauthorized', { status: 401 })
  }
  // La organización se resuelve antes de decidir: de ella sale el modo de
  // acceso. En modo `open` decide el rol, como siempre (crear un estudio es
  // administrarlo: el coordinador sube documentos, no abre estudios); en modo
  // estricto, la capacidad `study.create`.
  let org: NonNullable<Awaited<ReturnType<typeof resolveOrProvisionOrganization>>>
  let access: AccessSubject
  try {
    const resolved = await resolveOrProvisionOrganization(clerkOrgId)
    if (!resolved) throw new Error('Failed to provision organization')
    org = resolved
    access = await loadAccessSubject({ org, userId, role: normalizeRole(orgRole) })
  } catch (err) {
    return handleApiError(err)
  }
  if (!allows(access, 'study.create', canAdministerStudy)) {
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

      // Quien abre un estudio queda como miembro en la misma transacción
      // (docs/decisions/study-membership.md, regla 3). En modo `open` la fila
      // no restringe nada; en modo estricto, sin ella su creador no lo vería.
      await tx.insert(studyMemberships).values({
        organizationId: org.id,
        studyId: created.id,
        userId,
        createdBy: userId,
      })
      await tx.insert(auditLogs).values({
        action: 'access.membership.grant',
        organizationId: org.id,
        studyId: created.id,
        userId,
        resourceType: 'study_membership',
        resourceId: created.id,
        metadata: { memberUserId: userId, reason: 'study_creator' },
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
