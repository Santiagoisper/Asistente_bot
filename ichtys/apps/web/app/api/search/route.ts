import { auth } from '@clerk/nextjs/server'
import { canAccessPhiData, handleApiError, normalizeRole } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import { loadStudyScope } from '@ichtys/auth/study-scope'
import { allows } from '@ichtys/auth/functions'
import { db, eq, organizations } from '@ichtys/db'
import { isOsEnabled } from '../../../lib/flags'
import { searchOs } from '../../../lib/os/search'
import { EMPTY_SEARCH, normalizeSearchQuery } from '../../../lib/os/search-query'

export const runtime = 'nodejs'

/**
 * GET /api/search?q= — buscador del OS (estudios y sujetos de la organización
 * activa). La organización sale del token de Clerk, nunca del pedido.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    if (!isOsEnabled()) return new Response('Not Found', { status: 404 })

    const { userId, orgId: clerkOrgId, orgRole } = await auth()
    if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })

    const query = normalizeSearchQuery(new URL(req.url).searchParams.get('q'))
    if (!query) return Response.json(EMPTY_SEARCH)

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrgId, clerkOrgId),
    })
    if (!org) return Response.json(EMPTY_SEARCH)

    const access = await loadAccessSubject({ org, userId, role: normalizeRole(orgRole) })
    // Modo estricto: sin una función que permita entrar a estudios, el buscador
    // no devuelve nada. En modo `open` todo miembro de la organización buscaba.
    if (!allows(access, 'study.read', () => true)) return Response.json(EMPTY_SEARCH)

    // Alcance: en modo estricto el buscador solo recorre los estudios donde la
    // persona tiene membresía vigente, y los sujetos de esos estudios.
    const scope = await loadStudyScope({ access, orgId: org.id, userId })
    const results = await searchOs(org.id, query, {
      includeSubjects: allows(access, 'clinical.read', canAccessPhiData),
      scope,
    })
    return Response.json(results, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    return handleApiError(err)
  }
}
