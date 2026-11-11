import { auth, currentUser } from '@clerk/nextjs/server'
import { canAccessPhiData, canAdministerOrg, normalizeRole, resolveOrProvisionOrganization, type Role } from '@ichtys/auth'

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
 * sesión o no hay organización activa: en esos casos las pantallas muestran un
 * estado vacío, nunca datos.
 *
 * Una organización activa que todavía no existe en la base se da de alta acá,
 * igual que en Protocolos: un centro nuevo tiene que poder usar Inicio, Agenda
 * y Laboratorios desde la primera pantalla, sin pasar antes por otra.
 */
export async function getOsContext(): Promise<OsContext | null> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) return null

  const org = await resolveOrProvisionOrganization(clerkOrgId)
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
