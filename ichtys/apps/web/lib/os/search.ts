import { and, db, eq, sql, studies, subjects } from '@ichtys/db'
import { escapeLike, SEARCH_LIMIT_PER_TYPE, type SearchResults } from './search-query'

/**
 * Buscador del OS sobre lo que Alphi ya tiene. Siempre dentro de la
 * organización activa. Devuelve códigos y nombres de estudio, nunca contenido
 * clínico. Los sujetos solo se buscan si el rol puede ver datos de sujetos.
 */
export async function searchOs(
  orgId: string,
  query: string,
  opts: { includeSubjects: boolean },
): Promise<SearchResults> {
  const pattern = `%${escapeLike(query)}%`

  const studyRows = await db
    .select({ id: studies.id, name: studies.name, protocolNumber: studies.protocolNumber })
    .from(studies)
    .where(
      and(
        eq(studies.organizationId, orgId),
        sql`(${studies.name} ILIKE ${pattern} ESCAPE '\\' OR ${studies.protocolNumber} ILIKE ${pattern} ESCAPE '\\')`,
      ),
    )
    .orderBy(studies.name)
    .limit(SEARCH_LIMIT_PER_TYPE)

  const subjectRows = opts.includeSubjects
    ? await db
        .select({
          id: subjects.id,
          subjectCode: subjects.subjectCode,
          studyId: studies.id,
          studyName: studies.name,
          protocolNumber: studies.protocolNumber,
        })
        .from(subjects)
        .innerJoin(studies, and(eq(studies.id, subjects.studyId), eq(studies.organizationId, orgId)))
        .where(
          and(eq(subjects.organizationId, orgId), sql`${subjects.subjectCode} ILIKE ${pattern} ESCAPE '\\'`),
        )
        .orderBy(subjects.subjectCode)
        .limit(SEARCH_LIMIT_PER_TYPE)
    : []

  return {
    studies: studyRows.map((row) => ({
      id: row.id,
      label: row.protocolNumber?.trim() || row.name,
      detail: row.protocolNumber?.trim() ? row.name : 'Estudio',
      href: `/studies/${row.id}/chat`,
    })),
    subjects: subjectRows.map((row) => ({
      id: row.id,
      label: row.subjectCode,
      detail: row.protocolNumber?.trim() || row.studyName,
      href: `/studies/${row.studyId}/subjects/${row.id}`,
    })),
  }
}
