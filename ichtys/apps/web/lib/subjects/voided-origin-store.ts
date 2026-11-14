import { and, eq, inArray, sql } from 'drizzle-orm'
import { auditLogs, db, evolutionVoids } from '@ichtys/db'

interface SubjectScope {
  orgId: string
  studyId: string
  subjectId: string
}

/** Las evoluciones de este sujeto declaradas como registradas por error. Solo identificadores. */
export async function listVoidedEvolutionIds(scope: SubjectScope): Promise<string[]> {
  const rows = await db
    .select({ evolutionId: evolutionVoids.evolutionId })
    .from(evolutionVoids)
    .where(and(eq(evolutionVoids.organizationId, scope.orgId), eq(evolutionVoids.studyId, scope.studyId), eq(evolutionVoids.subjectId, scope.subjectId)))
  return rows.map((row) => row.evolutionId)
}

/**
 * De cuáles de esas evoluciones entró algo al perfil, según el registro de auditoría: cada
 * escritura del perfil que salió de una evolución queda registrada como `profile.update` con el
 * identificador de la evolución, en la misma transacción que la escritura (R3). Es la única
 * huella de las medicaciones y condiciones, que no guardan origen.
 */
export async function listAcceptedProposalEvolutionIds(scope: SubjectScope, evolutionIds: readonly string[]): Promise<string[]> {
  if (evolutionIds.length === 0) return []
  const evolutionId = sql<string>`${auditLogs.metadata}->>'evolutionId'`
  const rows = await db
    .selectDistinct({ evolutionId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, scope.orgId),
        eq(auditLogs.studyId, scope.studyId),
        eq(auditLogs.action, 'profile.update'),
        eq(auditLogs.resourceType, 'subject'),
        eq(auditLogs.resourceId, scope.subjectId),
        inArray(evolutionId, [...evolutionIds]),
        // El retiro también es un `profile.update` con esa evolución, y no es una aceptación.
        sql`coalesce(${auditLogs.metadata}->>'source', '') <> 'voided_origin_retire'`,
      ),
    )
  return rows.map((row) => row.evolutionId)
}
