import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import { db, organizations, studies, type Study } from '@ichtys/db'
import { isRole, roleSatisfies, type Role } from './roles'

/**
 * Error de acceso. Las API routes lo traducen a 401/403 con mensaje genérico
 * (NUNCA filtrar detalles internos al cliente — CLAUDE.md).
 */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message)
    this.name = 'AccessError'
  }
}

export interface StudyAccessContext {
  userId: string
  /** Clerk organization id (org_...) tomado SIEMPRE del token, nunca del request. */
  clerkOrgId: string
  /** organization_id interno (UUID) resuelto desde clerk_org_id. */
  organizationId: string
  role: Role
  study: Study
}

/**
 * Valida, server-side, que el usuario autenticado:
 *  1. tiene sesión y org activa (Clerk),
 *  2. la org existe en nuestra DB,
 *  3. el study pertenece a esa org (boundary de tenant),
 *  4. (opcional) su rol satisface `requiredRole`.
 *
 * Devuelve el contexto con el `organizationId` interno para usar en queries.
 * Cualquier ruta de datos DEBE pasar por acá antes de tocar el retrieval.
 */
export async function validateStudyAccess(
  studyId: string,
  requiredRole?: Role,
): Promise<StudyAccessContext> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()

  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })

  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  // study_id validado contra la org del token — nunca contra el body.
  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, studyId), eq(studies.organizationId, org.id)),
  })

  if (!study) {
    throw new AccessError('Study not found or access denied', 404)
  }

  const normalizedRole = normalizeRole(orgRole)

  if (requiredRole && !roleSatisfies(normalizedRole, requiredRole)) {
    throw new AccessError('Insufficient role', 403)
  }

  return {
    userId,
    clerkOrgId,
    organizationId: org.id,
    role: normalizedRole,
    study,
  }
}

/**
 * Convierte el rol de Clerk (p. ej. "org:study_admin") a un Role de Ichtys.
 * Default conservador: read_only_monitor (mínimo privilegio).
 */
function normalizeRole(orgRole: string | null | undefined): Role {
  if (!orgRole) return 'read_only_monitor'
  const stripped = orgRole.replace(/^org:/, '')
  return isRole(stripped) ? stripped : 'read_only_monitor'
}
