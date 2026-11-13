import { allows, type AccessSubject } from '@ichtys/auth/functions'
import { ROLES, roleSatisfies, type Role } from '@ichtys/auth/roles'
import type { MemberFunction } from '@ichtys/db'

/**
 * Quién opera «Equipo y accesos» (docs/decisions/study-membership.md, M11 a M14).
 * Las rutas y la pantalla deciden con estas mismas funciones.
 */

/** Modo `open`: asignar funciones era cosa del administrador de la organización. */
const wasOrgAdmin = (role: Role): boolean => role === ROLES.ORG_ADMIN

/** Asignar y quitar funciones, ver el equipo completo y cambiar el modo. */
export function canManageOrgAccess(access: AccessSubject): boolean {
  return allows(access, 'access.manage_org', wasOrgAdmin)
}

/** Requisito histórico para dar acceso a un estudio: administrarlo. */
export const STUDY_ACCESS_LEGACY_ROLE = ROLES.STUDY_ADMIN
export const couldManageStudyAccess = (role: Role): boolean => roleSatisfies(role, STUDY_ACCESS_LEGACY_ROLE)

/**
 * M4: la membresía de un monitor lleva vencimiento, con un máximo.
 * PROVISORIO: la decisión dice «máximo configurable» y no fija el número ni dónde se
 * configura. 365 días es un tope de resguardo hasta que Santiago lo defina.
 */
export const MONITOR_MEMBERSHIP_MAX_DAYS = 365

export type ExpiryProblem = 'monitor_requires_expiry' | 'expiry_in_past' | 'monitor_expiry_too_far'

/**
 * Valida el vencimiento de una membresía según las funciones de la persona.
 *
 * Sin fecha: solo el monitor la necesita (M4, M18 — lectura estricta: aunque
 * tenga otras funciones encima; una función extra no puede usarse de puerta de
 * servicio para saltear el control).
 *
 * Con fecha: TODA membresía se valida igual (precisión de M4, Santiago
 * 13/11/2026) — ni en el pasado ni más allá del máximo, monitor o no. Quien no
 * es monitor no necesita fecha, pero si la carga, esa fecha vale entera.
 */
export function checkMembershipExpiry(params: {
  targetFunctions: readonly MemberFunction[]
  expiresAt: Date | null
  now: Date
}): ExpiryProblem | null {
  const { targetFunctions, expiresAt, now } = params
  if (!expiresAt) return targetFunctions.includes('monitor') ? 'monitor_requires_expiry' : null

  if (expiresAt.getTime() <= now.getTime()) return 'expiry_in_past'
  const maxMs = MONITOR_MEMBERSHIP_MAX_DAYS * 24 * 60 * 60 * 1000
  if (expiresAt.getTime() - now.getTime() > maxMs) return 'monitor_expiry_too_far'
  return null
}
