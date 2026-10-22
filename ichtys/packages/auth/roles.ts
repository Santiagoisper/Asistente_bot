/**
 * Roles de Ichtys (PRD §7.1). Se mapean a roles/metadata de Clerk Organizations.
 * El rol determina qué acciones puede ejecutar un usuario dentro de una org/study.
 */
export const ROLES = {
  ORG_ADMIN: 'org_admin',
  STUDY_ADMIN: 'study_admin',
  SITE_COORDINATOR: 'site_coordinator',
  PRINCIPAL_INVESTIGATOR: 'principal_investigator',
  READ_ONLY_MONITOR: 'read_only_monitor',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

/**
 * Jerarquía de privilegio (mayor número = más privilegio).
 * Se usa para chequeos del tipo "requiere al menos study_admin".
 */
const ROLE_RANK: Record<Role, number> = {
  [ROLES.READ_ONLY_MONITOR]: 0,
  [ROLES.PRINCIPAL_INVESTIGATOR]: 1,
  [ROLES.SITE_COORDINATOR]: 1,
  [ROLES.STUDY_ADMIN]: 2,
  [ROLES.ORG_ADMIN]: 3,
}

export function isRole(value: string): value is Role {
  return (Object.values(ROLES) as string[]).includes(value)
}

/**
 * Convierte el rol de Clerk a un Role de Ichtys.
 * Clerk puede devolver "org:admin" (admin nativo) u "org:study_admin" (custom).
 * Default conservador: read_only_monitor (mínimo privilegio).
 */
export function normalizeRole(orgRole: string | null | undefined): Role {
  if (!orgRole) return ROLES.READ_ONLY_MONITOR
  const stripped = orgRole.replace(/^org:/, '')
  // Clerk admin nativo ("org:admin") mapea a org_admin de Ichtys.
  if (stripped === 'admin') return ROLES.ORG_ADMIN
  return isRole(stripped) ? stripped : ROLES.READ_ONLY_MONITOR
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
  return roleSatisfies(role, ROLES.SITE_COORDINATOR) && role !== ROLES.PRINCIPAL_INVESTIGATOR
}

export function canAdministerStudy(role: Role): boolean {
  return roleSatisfies(role, ROLES.STUDY_ADMIN)
}

export function canAdministerOrg(role: Role): boolean {
  return role === ROLES.ORG_ADMIN
}

/**
 * Acceso a datos clínicos de sujetos (PHI pseudonimizado).
 * read_only_monitor queda excluido — ver docs/compliance/ACCESS-CONTROL-POLICY.md
 */
export function canAccessPhiData(role: Role): boolean {
  return roleSatisfies(role, ROLES.PRINCIPAL_INVESTIGATOR)
}
