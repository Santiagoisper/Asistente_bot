import { auth } from '@clerk/nextjs/server'
import { canAccessPhiData, handleApiError, normalizeRole } from '@ichtys/auth'
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

    const results = await searchOs(org.id, query, {
      includeSubjects: canAccessPhiData(normalizeRole(orgRole)),
    })
    return Response.json(results, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    return handleApiError(err)
  }
}
