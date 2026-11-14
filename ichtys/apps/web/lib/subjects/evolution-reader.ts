import { and, clinicalEvolutions, db, desc, eq, evolutionVoids, isNull, type EvolutionVoidReason } from '@ichtys/db'

/**
 * El único lugar que lee evoluciones (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
 *
 * Una evolución registrada en el sujeto equivocado se anula: la fila no se toca, y que está
 * anulada se sabe porque existe una fila en `evolution_voids`. Eso deja un riesgo: cada
 * consulta suelta a `clinical_evolutions` puede olvidarse de mirar la otra tabla y tratar como
 * vigente lo que no lo es. Por eso toda lectura pasa por acá, y un test guardián
 * (`__tests__/evolution-reader-guard.test.ts`) falla si aparece una por fuera.
 *
 * Ninguna función tiene valor por defecto para las anuladas: quien lee decide a sabiendas.
 */

/**
 * - `'current'`: solo las vigentes. Es lo que corresponde para todo lo que *usa* una evolución:
 *   colgarle una grabación, proponer datos del perfil, contarla como actividad clínica.
 * - `'with-voided'`: también las anuladas, cada una con su marca. Para mostrar la historia
 *   (una corrección no tapa lo que estaba escrito) y para lo que es un hecho aunque se anule,
 *   como quién la escribió.
 */
export type EvolutionVoidPolicy = 'current' | 'with-voided'

export interface EvolutionScope {
  orgId: string
  studyId: string
  subjectId: string
}

/** Quién declaró que la evolución no correspondía a este sujeto, cuándo y por qué. Sin la nota. */
export interface EvolutionVoidMark {
  reason: EvolutionVoidReason
  declaredBy: string
  declaredAt: Date
}

export interface SubjectEvolution {
  id: string
  visitLabel: string | null
  contentEncrypted: string
  authorUserId: string
  dictationTakes: number | null
  createdAt: Date
  /** `null`: vigente. */
  voided: EvolutionVoidMark | null
}

export interface EvolutionRef {
  id: string
  authorUserId: string
  voided: EvolutionVoidMark | null
}

interface VoidColumns {
  voidId: string | null
  voidReason: EvolutionVoidReason | null
  voidDeclaredBy: string | null
  voidDeclaredAt: Date | null
}

const voidColumns = {
  voidId: evolutionVoids.id,
  voidReason: evolutionVoids.reason,
  voidDeclaredBy: evolutionVoids.declaredBy,
  voidDeclaredAt: evolutionVoids.declaredAt,
}

/** La anulación es de esta evolución y de su misma organización: una fila ajena no marca nada. */
function voidJoin() {
  return and(eq(evolutionVoids.evolutionId, clinicalEvolutions.id), eq(evolutionVoids.organizationId, clinicalEvolutions.organizationId))
}

/** La condición que deja afuera las anuladas, o nada si se piden todas. */
function voidFilter(policy: EvolutionVoidPolicy) {
  return policy === 'current' ? isNull(evolutionVoids.id) : undefined
}

function markOf(row: VoidColumns): EvolutionVoidMark | null {
  if (row.voidId === null || row.voidReason === null || row.voidDeclaredBy === null || row.voidDeclaredAt === null) return null
  return { reason: row.voidReason, declaredBy: row.voidDeclaredBy, declaredAt: row.voidDeclaredAt }
}

/** Las evoluciones de un sujeto, de la más nueva a la más vieja. */
export async function listSubjectEvolutions(scope: EvolutionScope, policy: EvolutionVoidPolicy): Promise<SubjectEvolution[]> {
  const rows = await db
    .select({
      id: clinicalEvolutions.id,
      visitLabel: clinicalEvolutions.visitLabel,
      contentEncrypted: clinicalEvolutions.contentEncrypted,
      authorUserId: clinicalEvolutions.authorUserId,
      dictationTakes: clinicalEvolutions.dictationTakes,
      createdAt: clinicalEvolutions.createdAt,
      ...voidColumns,
    })
    .from(clinicalEvolutions)
    .leftJoin(evolutionVoids, voidJoin())
    .where(
      and(
        eq(clinicalEvolutions.subjectId, scope.subjectId),
        eq(clinicalEvolutions.organizationId, scope.orgId),
        eq(clinicalEvolutions.studyId, scope.studyId),
        voidFilter(policy),
      ),
    )
    .orderBy(desc(clinicalEvolutions.createdAt))
  return rows.map((row) => ({
    id: row.id,
    visitLabel: row.visitLabel,
    contentEncrypted: row.contentEncrypted,
    authorUserId: row.authorUserId,
    dictationTakes: row.dictationTakes,
    createdAt: row.createdAt,
    voided: markOf(row),
  }))
}

/** Una evolución, solo si es de esta organización, este estudio y este sujeto. */
export async function findSubjectEvolution(params: EvolutionScope & { evolutionId: string }, policy: EvolutionVoidPolicy): Promise<EvolutionRef | null> {
  const [row] = await db
    .select({ id: clinicalEvolutions.id, authorUserId: clinicalEvolutions.authorUserId, ...voidColumns })
    .from(clinicalEvolutions)
    .leftJoin(evolutionVoids, voidJoin())
    .where(
      and(
        eq(clinicalEvolutions.id, params.evolutionId),
        eq(clinicalEvolutions.organizationId, params.orgId),
        eq(clinicalEvolutions.studyId, params.studyId),
        eq(clinicalEvolutions.subjectId, params.subjectId),
        voidFilter(policy),
      ),
    )
    .limit(1)
  return row ? { id: row.id, authorUserId: row.authorUserId, voided: markOf(row) } : null
}

/** Quiénes escribieron alguna evolución en la organización. */
export async function listEvolutionAuthors(orgId: string, policy: EvolutionVoidPolicy): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: clinicalEvolutions.authorUserId })
    .from(clinicalEvolutions)
    .leftJoin(evolutionVoids, voidJoin())
    .where(and(eq(clinicalEvolutions.organizationId, orgId), voidFilter(policy)))
  return rows.map((row) => row.userId)
}
