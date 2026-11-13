import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db, studyMemberships } from '@ichtys/db'
import { hasFullStudyScope, type AccessSubject } from './functions'

/**
 * ALCANCE: ¿esta persona entra a ESTE estudio?
 * (docs/decisions/study-membership.md, paso 3.)
 *
 * - Modo `open`: sí, como siempre. No se consulta nada.
 * - Modo estricto: sí si tiene una función con alcance total (las dos
 *   direcciones), o una membresía vigente en el estudio: sin baja y sin vencer.
 *
 * La capacidad (qué puede hacer adentro) se decide aparte, con `allows`. Los
 * dos ejes se comprueban siempre y ninguno reemplaza al otro.
 *
 * Devuelve un booleano y no lanza: cada validador responde con su propio 404,
 * el mismo que da cuando el estudio no existe.
 */
export async function canEnterStudy(params: {
  access: AccessSubject
  orgId: string
  studyId: string
  userId: string
  now?: Date
}): Promise<boolean> {
  if (params.access.mode === 'open') return true
  if (hasFullStudyScope(params.access.functions)) return true

  const now = params.now ?? new Date()
  const rows = await db
    .select({ id: studyMemberships.id })
    .from(studyMemberships)
    .where(
      and(
        eq(studyMemberships.organizationId, params.orgId),
        eq(studyMemberships.studyId, params.studyId),
        eq(studyMemberships.userId, params.userId),
        isNull(studyMemberships.revokedAt),
        activeMembershipCondition(params.access.functions.includes('monitor'), now),
      ),
    )
    .limit(1)

  return rows.length > 0
}

/**
 * La vigencia de una membresía, como condición de consulta (M18). Para el
 * monitor, una membresía sin fecha ya venció: es el hueco de orden — sumarse
 * al estudio antes de recibir la función dejaba la fecha en null y «sin fecha»
 * se leía como «no vence», acceso permanente justo lo que M18 impide. El resto
 * del equipo sin fecha sigue sin vencer.
 *
 * `canEnterStudy` (un estudio) y `loadStudyScope` (todos) leen la misma
 * condición: que los dos filtros divergieran era el otro costado del hueco.
 */
export function activeMembershipCondition(isMonitor: boolean, now: Date) {
  return isMonitor
    ? gt(studyMemberships.expiresAt, now)
    : or(isNull(studyMemberships.expiresAt), gt(studyMemberships.expiresAt, now))
}

/**
 * M18, forma predicado (la forma consulta es activeMembershipCondition): la
 * misma regla evaluada en memoria, para cálculos como el preview del cambio
 * de modo. Si una cambia, la otra también: se citan.
 */
export function membershipStillUsable(isMonitor: boolean, expiresAt: Date | null, now: Date): boolean {
  if (expiresAt === null) return !isMonitor
  return expiresAt.getTime() > now.getTime()
}
