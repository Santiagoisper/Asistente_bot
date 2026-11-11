import { auth } from '@clerk/nextjs/server'
import { canAdministerOrg, handleApiError, normalizeRole } from '@ichtys/auth'
import { db, eq, organizations } from '@ichtys/db'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { writeAuditLog } from '../../../../lib/chat/persistence'
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
    if (!canAdministerOrg(normalizeRole(orgRole))) return new Response('Forbidden', { status: 403 })

    const org = await db.query.organizations.findFirst({ where: eq(organizations.clerkOrgId, clerkOrgId) })
    if (!org) return new Response('Forbidden', { status: 403 })

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
      const checked = checkModuleInput(parsed.data)
      if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 })
      await saveOrgModule({ orgId: org.id, userId, module: parsed.data.module, baseUrl: checked.baseUrl, enabled: parsed.data.enabled })
      await writeAuditLog({
        action: 'org.integration.update',
        orgId: org.id,
        userId,
        resourceType: 'organization_integration',
        resourceId: parsed.data.module,
        metadata: { category: 'module', enabled: parsed.data.enabled, host: urlHost(checked.baseUrl) },
      })
      return Response.json({ status: 'saved' })
    }

    const checked = checkTimeZoneInput(parsed.data.timeZone)
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 })
    await saveOrgTimeZone({ orgId: org.id, timeZone: checked.timeZone })
    await writeAuditLog({
      action: 'org.os_settings.update',
      orgId: org.id,
      userId,
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { timeZone: checked.timeZone },
    })
    return Response.json({ status: 'saved' })
  } catch (err) {
    return handleApiError(err)
  }
}
