import type { AccessMode, MemberFunction } from '@ichtys/db'
import { ROLES, type Role } from './roles'

/**
 * Capacidades por función (docs/decisions/study-membership.md).
 *
 * Dos ejes, y los dos se comprueban siempre:
 *   - ALCANCE: a qué estudios entra la persona → membresía por estudio.
 *   - CAPACIDAD: qué puede hacer adentro → sus funciones (este módulo).
 *
 * No hay una escala global: no existe «al menos tal función». Sí hay
 * composición explícita: Dirección de Operaciones contiene todo lo del Study
 * Coordinator, y este todo lo de los tres asistentes. Esa contención está
 * escrita una sola vez (COORDINATION) y la comprueba una prueba, para que
 * agregar una capacidad abajo no deje sin ella a quien está arriba.
 *
 * Cada capacidad nombra el par `dato.operación` (`clinical.read`,
 * `labs.manage`): así «lee el estudio pero no los datos clínicos» (monitor)
 * se expresa sin casos especiales. Una persona puede tener varias funciones y
 * sus capacidades son la suma.
 *
 * Módulo puro: no toca la base ni la sesión. Quien lo llama trae el modo de la
 * organización, el rol histórico y las funciones vigentes de la persona.
 */

export const CAPABILITIES = [
  /** Entrar al estudio: protocolo, documentos en lectura, asistente. */
  'study.read',
  /** Ver datos clínicos de los sujetos. */
  'clinical.read',
  /** Evolucionar y responder queries. Solo el médico. */
  'clinical.author',
  /** Cargar y confirmar valores de laboratorio. */
  'labs.manage',
  /** Subir y gestionar documentos, SOA y hojas de visita. */
  'documents.manage',
  /** Ver qué va al CRF, levantar queries y seguir su plazo. */
  'crf.manage',
  /** Turnos y agenda del estudio. */
  'agenda.manage',
  /** Crear estudios. */
  'study.create',
  /** Dar y quitar acceso a los estudios propios. */
  'access.manage_study',
  /** Asignar funciones, administrar equipos y el modo de acceso. */
  'access.manage_org',
  /** Ajustes de la organización, claves e integraciones. */
  'org.settings',
] as const
export type Capability = (typeof CAPABILITIES)[number]

// El equipo ve el estudio y los datos clínicos; no gestiona agenda ni
// laboratorios. Esas son tareas operativas del Study Coordinator (y del
// asistente correspondiente), no del equipo entero.
const TEAM_BASE: readonly Capability[] = ['study.read', 'clinical.read']

const COORDINATION: readonly Capability[] = [
  ...TEAM_BASE,
  'labs.manage',
  'documents.manage',
  'crf.manage',
  'agenda.manage',
  'study.create',
  'access.manage_study',
]

/**
 * La tabla del documento, en código. Reglas que esta tabla tiene que cumplir
 * siempre (las comprueba functions.test.ts):
 *   - `clinical.author` aparece SOLO en `investigator`: no se hereda de ninguna
 *     dirección ni de la administración.
 *   - `platform_admin` no trae datos clínicos ni entrada a estudios (M12).
 *   - `monitor` lee el estudio y nada más.
 */
export const FUNCTION_CAPABILITIES: Record<MemberFunction, readonly Capability[]> = {
  investigator: [...TEAM_BASE, 'clinical.author'],
  study_coordinator: COORDINATION,
  lab_assistant: [...TEAM_BASE, 'labs.manage'],
  regulatory_assistant: [...TEAM_BASE, 'documents.manage'],
  crf_assistant: [...TEAM_BASE, 'crf.manage'],
  operations_director: [...COORDINATION, 'access.manage_org'],
  research_director: ['study.read', 'clinical.read'],
  monitor: ['study.read'],
  platform_admin: ['org.settings', 'access.manage_org'],
}

/** Funciones que entran a todos los estudios de la organización sin membresía (M10). */
export const FULL_SCOPE_FUNCTIONS: readonly MemberFunction[] = ['operations_director', 'research_director']

export function capabilitiesOf(functions: readonly MemberFunction[]): ReadonlySet<Capability> {
  const capabilities = new Set<Capability>()
  for (const fn of functions) {
    for (const capability of FUNCTION_CAPABILITIES[fn]) capabilities.add(capability)
  }
  return capabilities
}

export function hasFullStudyScope(functions: readonly MemberFunction[]): boolean {
  return functions.some((fn) => FULL_SCOPE_FUNCTIONS.includes(fn))
}

function isMemberFunction(value: string): value is MemberFunction {
  return Object.prototype.hasOwnProperty.call(FUNCTION_CAPABILITIES, value)
}

/**
 * Funciones leídas de la base. Un nombre que este código no conoce NO se
 * ignora en silencio: no da ninguna capacidad (se restringe) y vuelve aparte,
 * para que la pantalla de administración lo muestre. La base ya lo impide con
 * un CHECK; esto cubre el caso de código más viejo que la base.
 */
export function parseMemberFunctions(values: readonly string[]): { known: MemberFunction[]; unknown: string[] } {
  const known: MemberFunction[] = []
  const unknown: string[] = []
  for (const value of values) {
    if (!isMemberFunction(value)) unknown.push(value)
    else if (!known.includes(value)) known.push(value)
  }
  return { known, unknown }
}

/**
 * Modo de acceso leído de la base. Cualquier valor que no sea exactamente
 * `open` se trata como `enforced`: ante la duda, se restringe.
 */
export function parseAccessMode(value: unknown): AccessMode {
  return value === 'open' ? 'open' : 'enforced'
}

/** Lo que hace falta saber de una persona para decidir una capacidad. */
export interface AccessSubject {
  mode: AccessMode
  /** Rol histórico, del proveedor de identidad. Solo decide en modo `open`. */
  role: Role
  /** Funciones vigentes de la persona en la organización. Solo deciden en modo `enforced`. */
  functions: readonly MemberFunction[]
}

/**
 * ¿La persona tiene esta capacidad?
 *
 * - Modo `open`: decide `legacyCheck`, la comprobación por rol que la ruta
 *   hacía antes de este módulo. El comportamiento es idéntico al histórico y
 *   las funciones cargadas no restringen ni amplían nada.
 * - Modo `enforced`: deciden las funciones. El rol histórico no cuenta.
 */
export function allows(
  subject: AccessSubject,
  capability: Capability,
  legacyCheck: (role: Role) => boolean,
): boolean {
  if (subject.mode === 'open') return legacyCheck(subject.role)
  return capabilitiesOf(subject.functions).has(capability)
}

/**
 * Función sugerida para quien todavía no tiene ninguna cargada. Es un punto de
 * partida para la pantalla «Equipo y accesos»: NO autoriza nada. Los roles
 * viven en el proveedor de identidad, así que esto no se puede sembrar con
 * una migración.
 */
export function suggestedFunctionsForLegacyRole(role: Role): MemberFunction[] {
  switch (role) {
    case ROLES.PRINCIPAL_INVESTIGATOR:
      return ['investigator']
    case ROLES.SITE_COORDINATOR:
    case ROLES.STUDY_ADMIN:
      return ['study_coordinator']
    case ROLES.ORG_ADMIN:
      return ['operations_director', 'platform_admin']
    case ROLES.READ_ONLY_MONITOR:
      return ['monitor']
  }
}
