import { AccessError, handleApiError } from '@ichtys/auth'
import { z } from 'zod'
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

// Regla 11 de docs/CLAUDE.md: la entrada de una API se valida con zod.
const HistoryQuery = z.object({
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(ACCESS_HISTORY_MAX_PAGE))
    .optional()
    .transform((value) => value ?? DEFAULT_PAGE),
  before: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return null
      const cursor = decodeHistoryCursor(raw)
      if (!cursor) {
        ctx.addIssue({ code: 'custom', message: 'invalid cursor' })
        return z.NEVER
      }
      return cursor
    }),
})

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
    const parsed = HistoryQuery.safeParse({
      limit: params.get('limit') ?? undefined,
      before: params.get('before') ?? undefined,
    })
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })
    const { limit, before } = parsed.data

    const page = await loadAccessHistory(context.orgId, { limit, before })
    return Response.json({ entries: page.entries, next: page.next ? encodeHistoryCursor(page.next) : null })
  } catch (err) {
    return handleApiError(err)
  }
}
