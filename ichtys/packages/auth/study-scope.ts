import { and, eq, gt, inArray, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { db, studyMemberships } from '@ichtys/db'
import { capabilitiesOf, hasFullStudyScope, type AccessSubject } from './functions'

/**
 * ALCANCE para listados y agregados (docs/decisions/study-membership.md, paso 4).
 *
 * Los validadores responden «¿entra a ESTE estudio?» (`canEnterStudy`). Las
 * pantallas que listan o cuentan necesitan la otra pregunta: «¿cuáles ve?».
 *
 * - `all`: modo `open`, o una función con alcance total (las dos direcciones).
 * - `ids`: solo los estudios con membresía vigente. Una lista vacía significa
 *   que no ve ninguno; nunca se interpreta como «sin filtro».
 *
 * Alcance y capacidad son ejes independientes y los listados necesitan los dos:
 * en modo estricto, quien no tiene `study.read` no ve ningún estudio aunque
 * conserve una membresía (por ejemplo, quien solo administra la plataforma, o
 * alguien a quien se le dieron de baja las funciones). Es la misma regla que
 * aplican los validadores, que exigen `study.read` antes de mirar la membresía.
 */
export type StudyScope = { readonly kind: 'all' } | { readonly kind: 'ids'; readonly studyIds: readonly string[] }

export const ALL_STUDIES: StudyScope = { kind: 'all' }
const NO_STUDIES: StudyScope = { kind: 'ids', studyIds: [] }

export async function loadStudyScope(params: {
  access: AccessSubject
  orgId: string
  userId: string
  now?: Date
}): Promise<StudyScope> {
  if (params.access.mode === 'open') return ALL_STUDIES
  if (!capabilitiesOf(params.access.functions).has('study.read')) return NO_STUDIES
  if (hasFullStudyScope(params.access.functions)) return ALL_STUDIES

  const now = params.now ?? new Date()
  const rows = await db
    .select({ studyId: studyMemberships.studyId })
    .from(studyMemberships)
    .where(
      and(
        eq(studyMemberships.organizationId, params.orgId),
        eq(studyMemberships.userId, params.userId),
        isNull(studyMemberships.revokedAt),
        or(isNull(studyMemberships.expiresAt), gt(studyMemberships.expiresAt, now)),
      ),
    )

  return { kind: 'ids', studyIds: [...new Set(rows.map((row) => row.studyId))] }
}

export function scopeIncludesStudy(scope: StudyScope, studyId: string): boolean {
  return scope.kind === 'all' || scope.studyIds.includes(studyId)
}

/**
 * Condición para sumar al `where` de una consulta, sobre la columna que lleva
 * el estudio (`studies.id`, o `study_id` en una tabla hija).
 *
 * `all` no agrega nada (`and` descarta `undefined`). Una lista vacía devuelve
 * una condición que nunca se cumple: sin esto, `inArray(col, [])` es un error
 * en tiempo de ejecución y la tentación sería saltear el filtro.
 */
export function studyScopeFilter(scope: StudyScope, studyColumn: AnyColumn): SQL | undefined {
  if (scope.kind === 'all') return undefined
  if (scope.studyIds.length === 0) return sql`false`
  return inArray(studyColumn, [...scope.studyIds])
}

/**
 * Como `studyScopeFilter`, pero deja pasar las filas que no pertenecen a
 * ningún estudio (por ejemplo, eventos de auditoría de la organización).
 */
export function studyScopeOrOrgLevelFilter(scope: StudyScope, studyColumn: AnyColumn): SQL | undefined {
  if (scope.kind === 'all') return undefined
  return or(isNull(studyColumn), studyScopeFilter(scope, studyColumn))
}
