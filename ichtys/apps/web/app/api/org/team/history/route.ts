import { AccessError, handleApiError } from '@ichtys/auth'
import { resolveOrgAccessContext } from '../../../../../lib/access/org-context'
import { canManageOrgAccess } from '../../../../../lib/access/permissions'
import {
  ACCESS_HISTORY_MAX_PAGE,
  decodeHistoryCursor,
  encodeHistoryCursor,
  loadAccessHistory,
} from '../../../../../lib/access/team-history'

export const runtime = 'nodejs'

const DEFAULT_PAGE = 30

/**
 * GET /api/org/team/history — «qué cambió y quién» en los accesos del centro
 * (docs/decisions/study-membership.md, paso 5). Mismo permiso que la lista del
 * equipo: solo quien administra accesos. Sale del registro de auditoría de la
 * organización; nunca de otra. `?before=` pide la página siguiente.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const context = await resolveOrgAccessContext()
    if (!canManageOrgAccess(context.access)) throw new AccessError('Insufficient role', 403)

    const params = new URL(req.url).searchParams
    const rawLimit = params.get('limit')
    let limit = DEFAULT_PAGE
    if (rawLimit !== null) {
      if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > ACCESS_HISTORY_MAX_PAGE) {
        return Response.json({ error: 'invalid_input' }, { status: 400 })
      }
      limit = Number(rawLimit)
    }
    const rawBefore = params.get('before')
    const before = rawBefore === null ? null : decodeHistoryCursor(rawBefore)
    if (rawBefore !== null && !before) return Response.json({ error: 'invalid_input' }, { status: 400 })

    const page = await loadAccessHistory(context.orgId, { limit, before })
    return Response.json({ entries: page.entries, next: page.next ? encodeHistoryCursor(page.next) : null })
  } catch (err) {
    return handleApiError(err)
  }
}
