import { auth } from '@clerk/nextjs/server'
import { canAdministerOrg, handleApiError, normalizeRole } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import { allows } from '@ichtys/auth/functions'
import { db, eq, organizations } from '@ichtys/db'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { auditedWrite } from '../../../../lib/audit/audited-write'
import { isOsEnabled } from '../../../../lib/flags'
import { checkModuleInput, checkTimeZoneInput, orgConfigInputSchema, urlHost } from '../../../../lib/os/org-admin'
import { saveOrgModule, saveOrgTimeZone } from '../../../../lib/os/org-admin-service'

export const runtime = 'nodejs'

/**
 * PUT /api/os/org-config — un administrador conecta un módulo o fija la zona
 * horaria de su centro. La organización sale del token de Clerk, nunca del
 * pedido. No acepta credenciales.
 */
export async function PUT(req: Request): Promise<Response> {
  try {
    if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

    const { userId, orgId: clerkOrgId, orgRole } = await auth()
    if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })
    const org = await db.query.organizations.findFirst({ where: eq(organizations.clerkOrgId, clerkOrgId) })
    if (!org) return new Response('Forbidden', { status: 403 })

    // En modo `open` decide el rol de administrador de la organización; en modo
    // estricto, la capacidad `org.settings`.
    const access = await loadAccessSubject({ org, userId, role: normalizeRole(orgRole) })
    if (!allows(access, 'org.settings', canAdministerOrg)) return new Response('Forbidden', { status: 403 })

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
      return new Response('Bad Request', { status: 400 })
    }
    const parsed = orgConfigInputSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })

    if (parsed.data.kind === 'module') {
      const checked = checkModuleInput(parsed.data, { allowLocal: process.env.NODE_ENV === 'development' })
      if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 })
      const { module, enabled } = parsed.data
      // La conexión y su registro de auditoría se confirman en la misma transacción (R3).
      await auditedWrite(
        (tx) => saveOrgModule({ executor: tx, orgId: org.id, userId, module, baseUrl: checked.baseUrl, enabled }),
        () => ({
          action: 'org.integration.update',
          orgId: org.id,
          userId,
          resourceType: 'organization_integration',
          resourceId: module,
          metadata: { category: 'module', enabled, host: urlHost(checked.baseUrl) },
        }),
      )
      return Response.json({ status: 'saved' })
    }

    const checked = checkTimeZoneInput(parsed.data.timeZone)
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 })
    await auditedWrite(
      (tx) => saveOrgTimeZone({ executor: tx, orgId: org.id, timeZone: checked.timeZone }),
      () => ({
        action: 'org.os_settings.update',
        orgId: org.id,
        userId,
        resourceType: 'organization',
        resourceId: org.id,
        metadata: { timeZone: checked.timeZone },
      }),
    )
    return Response.json({ status: 'saved' })
  } catch (err) {
    return handleApiError(err)
  }
}
