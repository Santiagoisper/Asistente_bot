/**
 * Roles de Ichtys (PRD §7.1). Se mapean a roles/metadata de Clerk Organizations.
 * El rol determina qué acciones puede ejecutar un usuario dentro de una org/study.
 */
export const ROLES = [
  'org_admin',
  'study_admin',
  'site_coordinator',
  'principal_investigator',
  'read_only_monitor',
] as const

export type Role = (typeof ROLES)[number]

/**
 * Jerarquía de privilegio (mayor número = más privilegio).
 * Se usa para chequeos del tipo "requiere al menos study_admin".
 */
const ROLE_RANK: Record<Role, number> = {
  read_only_monitor: 0,
  principal_investigator: 1,
  site_coordinator: 1,
  study_admin: 2,
  org_admin: 3,
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/**
 * ¿`role` satisface el requisito mínimo `required`?
 */
export function roleSatisfies(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

/**
 * Capacidades de escritura. Monitores e investigadores son read-only sobre
 * la gestión documental; coordinadores en adelante pueden subir/gestionar.
 */
export function canManageDocuments(role: Role): boolean {
  return roleSatisfies(role, 'site_coordinator') && role !== 'principal_investigator'
}

export function canAdministerStudy(role: Role): boolean {
  return roleSatisfies(role, 'study_admin')
}

export function canAdministerOrg(role: Role): boolean {
  return role === 'org_admin'
}
