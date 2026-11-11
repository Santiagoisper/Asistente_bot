import { auth, currentUser } from '@clerk/nextjs/server'
import { canAccessPhiData, canAdministerOrg, normalizeRole, type Role } from '@ichtys/auth'
import { db, eq, organizations } from '@ichtys/db'

export interface OsContext {
  userId: string
  /** Id interno de la organización, resuelto desde el token de Clerk. Nunca viene del pedido. */
  orgId: string
  role: Role
  /** Puede ver datos de sujetos (códigos, pendientes de laboratorio). */
  canSeeSubjects: boolean
  canAdministerOrg: boolean
}

/**
 * Contexto del usuario para las pantallas del OS. Devuelve null si no hay
 * sesión, no hay organización activa o la organización todavía no existe en
 * la base: en esos casos las pantallas muestran un estado vacío, nunca datos.
 */
export async function getOsContext(): Promise<OsContext | null> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) return null

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (!org) return null

  const role = normalizeRole(orgRole)
  return {
    userId,
    orgId: org.id,
    role,
    canSeeSubjects: canAccessPhiData(role),
    canAdministerOrg: canAdministerOrg(role),
  }
}

/** Nombre de pila para el saludo. Si Clerk no responde, el saludo va sin nombre. */
export async function getFirstName(): Promise<string | null> {
  try {
    const user = await currentUser()
    const name = user?.firstName?.trim()
    return name ? name.slice(0, 60) : null
  } catch {
    return null
  }
}
