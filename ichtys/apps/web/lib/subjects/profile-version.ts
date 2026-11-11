import { and, eq, patientProfiles, sql } from '@ichtys/db'

/**
 * Control de versión del perfil del sujeto usando su `updated_at`.
 *
 * Varias personas trabajan sobre el mismo sujeto a la vez. Una escritura solo
 * se aplica si la fila sigue como se la leyó; si alguien escribió en el medio,
 * no toca nada y quien llama vuelve a leer.
 */

export interface ProfileScope {
  orgId: string
  studyId: string
  subjectId: string
}

/**
 * Condición de escritura: la fila del sujeto (dentro de su organización y su
 * estudio) no cambió desde `expected`. Se compara al milisegundo porque la
 * base guarda microsegundos y la aplicación lee milisegundos.
 */
export function whereProfileUnchanged(scope: ProfileScope, expected: Date) {
  return and(
    eq(patientProfiles.organizationId, scope.orgId),
    eq(patientProfiles.studyId, scope.studyId),
    eq(patientProfiles.subjectId, scope.subjectId),
    sql`date_trunc('milliseconds', ${patientProfiles.updatedAt}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`,
  )
}

/** Marca de tiempo de la nueva versión: siempre posterior a la anterior, aunque caigan en el mismo milisegundo. */
export function nextVersion(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1))
}
