import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import { db, studies, type Study } from '@ichtys/db'
import { loadAccessSubject } from './access-subject'
import { allows, type AccessSubject, type Capability } from './functions'
import { normalizeRole, roleSatisfies, type Role } from './roles'
import { resolveOrProvisionOrganization } from './resolve-org'

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
  /** Clerk user id, tomado SIEMPRE del token. */
  userId: string
  /**
   * organization_id INTERNO (UUID) resuelto desde el clerk_org_id del token.
   * Es el valor que se usa para filtrar por tenant en todas las queries.
   */
  orgId: string
  study: Study
  /** Rol normalizado del token. La gestión documental lo vuelve a evaluar. */
  role: Role
  /** Modo de la organización y funciones de la persona, para decidir capacidades con `allows`. */
  access: AccessSubject
}

/** En modo `open` no había comprobación: todo miembro de la organización entraba a sus estudios. */
const ANY_MEMBER = (): boolean => true

/**
 * Valida, server-side, que el usuario autenticado:
 *  1. tiene sesión y org activa (Clerk),
 *  2. la org existe en nuestra DB,
 *  3. el study pertenece a esa org (boundary de tenant),
 *  4. en modo estricto, tiene alguna función que permita entrar a estudios,
 *  5. (opcional) cumple el requisito de la ruta: `requiredRole` en modo `open`,
 *     `requiredCapability` en modo estricto. Una ruta que en modo estricto
 *     pide un rol sin nombrar la capacidad equivalente queda cerrada.
 *
 * Devuelve el contexto con el `organizationId` interno para usar en queries.
 * Cualquier ruta de datos DEBE pasar por acá antes de tocar el retrieval.
 */
export async function validateStudyAccess(
  studyId: string,
  requiredRole?: Role,
  requiredCapability?: Capability,
): Promise<StudyAccessContext> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()

  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const org = await resolveOrProvisionOrganization(clerkOrgId)

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

  const role = normalizeRole(orgRole)
  const access = await loadAccessSubject({ org, userId, role })

  // Misma respuesta que para un estudio que no existe: no se confirma su
  // existencia a quien no puede entrar.
  if (!allows(access, 'study.read', ANY_MEMBER)) {
    throw new AccessError('Study not found or access denied', 404)
  }

  if (requiredRole) {
    const satisfied =
      access.mode === 'open'
        ? roleSatisfies(role, requiredRole)
        : requiredCapability !== undefined && allows(access, requiredCapability, ANY_MEMBER)
    if (!satisfied) throw new AccessError('Insufficient role', 403)
  }

  return { userId, orgId: org.id, study, role, access }
}
