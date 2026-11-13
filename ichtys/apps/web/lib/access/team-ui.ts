import { ROLES, type Role } from '@ichtys/auth/roles'
import type { MemberFunction } from '@ichtys/db'
import { MONITOR_MEMBERSHIP_MAX_DAYS, type ExpiryProblem } from './permissions'

/**
 * Textos de «Equipo y accesos» (docs/decisions/study-membership.md).
 *
 * L6: lo que la pantalla le enseña a la persona sale de estas constantes —
 * la pantalla y su prueba importan el mismo archivo, y el tope de días de la
 * guía es la MISMA constante con la que el servidor valida. Nada de copias.
 */

/** Nombre legible de cada función (la lista cerrada la fija el tipo). */
export const FUNCTION_LABELS: Record<MemberFunction, string> = {
  investigator: 'Investigador/a',
  study_coordinator: 'Study Coordinator',
  lab_assistant: 'Asistente de laboratorio',
  regulatory_assistant: 'Asistente regulatorio',
  crf_assistant: 'Asistente de CRF',
  operations_director: 'Dirección de Operaciones',
  research_director: 'Dirección de Investigación',
  monitor: 'Monitor',
  platform_admin: 'Administración de plataforma',
}

/** Una línea de qué habilita cada función (M11, M12 y M16 del doc). */
export const FUNCTION_HINTS: Record<MemberFunction, string> = {
  investigator: 'Evoluciona sujetos y confirma laboratorios de sus estudios.',
  study_coordinator: 'Coordina sus estudios: documentos, CRF, laboratorios y accesos.',
  lab_assistant: 'Carga y confirma valores de laboratorio.',
  regulatory_assistant: 'Gestiona los documentos del estudio.',
  crf_assistant: 'Mira el CRF y sigue las queries.',
  operations_director: 'Entra a todos los estudios y administra el equipo.',
  research_director: 'Lee los estudios, sin operar.',
  monitor: 'Solo lectura; su acceso a cada estudio vence (M4).',
  platform_admin: 'Ajustes y equipo de la organización; sin datos clínicos (M12).',
}

/** Rol histórico del proveedor de identidad: decide solo en modo abierto. */
export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.ORG_ADMIN]: 'Administración de la organización',
  [ROLES.STUDY_ADMIN]: 'Study Admin',
  [ROLES.SITE_COORDINATOR]: 'Coordinación de sitio',
  [ROLES.PRINCIPAL_INVESTIGATOR]: 'Medicina investigadora',
  [ROLES.READ_ONLY_MONITOR]: 'Monitor de solo lectura',
}

export const MODE_TEXTS = {
  open: {
    title: 'Modo abierto',
    detail:
      'Como hasta hoy: todo integrante de la organización entra a sus estudios. Las funciones cargadas todavía no restringen nada; empezarán a decidir cuando se pase a modo estricto.',
  },
  enforced: {
    title: 'Modo estricto',
    detail:
      'Cada persona entra solo a los estudios donde tiene un acceso vigente, y lo que puede hacer adentro lo deciden sus funciones.',
  },
} as const

/**
 * Traducción de los rechazos de la API. El tope de días sale de la misma
 * constante del servidor (PROVISORIO: M4 dice «máximo configurable»).
 */
export const API_ERROR_TEXTS: Record<ExpiryProblem | 'not_a_member' | 'invalid_input', string> = {
  monitor_requires_expiry: 'Quien tiene la función Monitor necesita fecha de vencimiento del acceso.',
  expiry_in_past: 'La fecha de vencimiento ya pasó.',
  monitor_expiry_too_far: `El vencimiento no puede estar a más de ${MONITOR_MEMBERSHIP_MAX_DAYS} días.`,
  not_a_member: 'Esa persona ya no pertenece a la organización; recargá la lista.',
  invalid_input: 'Revisá los datos del formulario.',
}

/** Guía del cuadro de acceso a un estudio (M4, M18, M19). */
export const ACCESS_EXPIRY_GUIDE = `El vencimiento es obligatorio para quien tiene la función Monitor y se le exige aunque tenga otras (M18). Para el resto es opcional, pero si se carga, se valida igual: ni en el pasado ni a más de ${MONITOR_MEMBERSHIP_MAX_DAYS} días (M19).`
