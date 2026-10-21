import { auth } from '@clerk/nextjs/server'
import { AccessError, handleApiError, resolveOrProvisionOrganization } from '@ichtys/auth'
import { ROLES, isRole, roleSatisfies } from '@ichtys/auth/roles'
import { getQuotaStatus, getUsagePeriod, getUsageSummary } from '@ichtys/db'
import { buildUsageView } from '../../../../lib/usage-view'

export const runtime = 'nodejs'

function normalizeRole(orgRole: string | null | undefined) {
  if (!orgRole) return ROLES.READ_ONLY_MONITOR
  const stripped = orgRole.replace(/^org:/, '')
  if (stripped === 'admin') return ROLES.ORG_ADMIN
  return isRole(stripped) ? stripped : ROLES.READ_ONLY_MONITOR
}

/**
 * GET /api/org/usage — consumo estimado y cupo del mes en curso de la organización activa.
 *
 * Solo study_admin o superior (el consumo es un dato comercial de la organización). El
 * organization_id sale siempre del token de Clerk, nunca del request. Devuelve únicamente
 * conteos e importes estimados: ningún texto de preguntas ni de documentos.
 */
export async function GET(): Promise<Response> {
  try {
    const { userId, orgId: clerkOrgId, orgRole } = await auth()
    if (!userId || !clerkOrgId) throw new AccessError('Unauthorized', 401)

    if (!roleSatisfies(normalizeRole(orgRole), ROLES.STUDY_ADMIN)) {
      throw new AccessError('Insufficient role', 403)
    }

    const org = await resolveOrProvisionOrganization(clerkOrgId)
    if (!org) throw new AccessError('Organization not found', 403)

    const period = getUsagePeriod()
    try {
      const [quota, summary] = await Promise.all([
        getQuotaStatus(org.id),
        getUsageSummary(org.id, period),
      ])

      return Response.json(buildUsageView(quota, summary), {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch (err) {
      // Mientras la migración 0009 no esté aplicada, las tablas/columnas no existen.
      if (isMissingUsageSchema(err)) {
        return Response.json({ error: 'usage_not_enabled' }, { status: 503 })
      }
      throw err
    }
  } catch (err) {
    return handleApiError(err)
  }
}

/** Error de "la tabla/columna no existe" sobre los objetos de la migración 0009. */
function isMissingUsageSchema(err: unknown): boolean {
  const messages: string[] = []
  let current: unknown = err
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    messages.push(current.message)
    current = current.cause
  }
  const text = messages.join(' ')
  return /does not exist/i.test(text) && /usage_events|monthly_budget_micros|plan_name/i.test(text)
}
