import { allows, capabilitiesOf, type AccessSubject } from '@ichtys/auth/functions'
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
 * Quien es SOLO monitor necesita fecha; quien además trabaja en el centro con otra
 * función que entra a estudios, no (su acceso no depende de la visita de monitoreo).
 */
export function checkMembershipExpiry(params: {
  targetFunctions: readonly MemberFunction[]
  expiresAt: Date | null
  now: Date
}): ExpiryProblem | null {
  const { targetFunctions, expiresAt, now } = params
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'expiry_in_past'

  const onlyMonitor =
    targetFunctions.includes('monitor') &&
    !targetFunctions.some((fn) => fn !== 'monitor' && capabilitiesOf([fn]).has('study.read'))
  if (!onlyMonitor) return null

  if (!expiresAt) return 'monitor_requires_expiry'
  const maxMs = MONITOR_MEMBERSHIP_MAX_DAYS * 24 * 60 * 60 * 1000
  if (expiresAt.getTime() - now.getTime() > maxMs) return 'monitor_expiry_too_far'
  return null
}
