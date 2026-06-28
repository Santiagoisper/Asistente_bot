import { and, desc, eq } from 'drizzle-orm'
import { db, studySpecs, type StudySpecRow } from '@ichtys/db'
import { studySpecSchema, type StudySpec } from './study-spec'
import type { ApprovedSpecExample } from './spec-extractor'

/**
 * spec-store.ts — persistencia versionada del study spec.
 *
 * - Valida el spec con Zod ANTES de insertar: ninguna escritura de jsonb
 *   sin contrato.
 * - version = última versión del estudio + 1. Nace 'draft' siempre.
 * - El caller resuelve orgId desde el token (nunca del input del cliente) y
 *   valida acceso al study antes de llamar — mismo contrato que el resto
 *   del pipeline de ingestion.
 */

export interface SaveStudySpecParams {
  orgId: string
  studyId: string
  documentVersionId: string
  spec: StudySpec
  extractionModel: string
}

export interface SavedStudySpec {
  id: string
  version: number
}

export async function saveStudySpec(params: SaveStudySpecParams): Promise<SavedStudySpec> {
  const spec = studySpecSchema.parse(params.spec)

  const latest = await db
    .select({ version: studySpecs.version })
    .from(studySpecs)
    .where(and(eq(studySpecs.organizationId, params.orgId), eq(studySpecs.studyId, params.studyId)))
    .orderBy(desc(studySpecs.version))
    .limit(1)

  const version = (latest[0]?.version ?? 0) + 1

  const [row] = await db
    .insert(studySpecs)
    .values({
      organizationId: params.orgId,
      studyId: params.studyId,
      documentVersionId: params.documentVersionId,
      version,
      status: 'draft',
      spec,
      extractionModel: params.extractionModel,
    })
    .returning({ id: studySpecs.id, version: studySpecs.version })

  if (!row) throw new Error('Failed to persist study spec')
  return row
}

/**
 * Devuelve specs aprobados por humanos de la org para usar como few-shot.
 * El orden es por fecha descendente (los más recientes primero).
 * Estos ejemplos son el flywheel propietario de ALPHI: cada aprobación
 * humana mejora las extracciones futuras de la misma organización.
 */
export async function getApprovedSpecExamples(params: {
  orgId: string
  limit?: number
}): Promise<ApprovedSpecExample[]> {
  const rows = await db
    .select({
      spec: studySpecs.spec,
    })
    .from(studySpecs)
    .where(
      and(
        eq(studySpecs.organizationId, params.orgId),
        eq(studySpecs.status, 'approved'),
      ),
    )
    .orderBy(desc(studySpecs.updatedAt))
    .limit(params.limit ?? 3)

  return rows.map(row => {
    const spec = studySpecSchema.safeParse(row.spec)
    if (!spec.success) return null
    const protocolCode = spec.data.identification.protocolCode ?? null
    return { protocolCode, spec: spec.data }
  }).filter((x): x is ApprovedSpecExample => x !== null)
}

/**
 * Devuelve la última versión del spec del estudio (cualquier status), o la
 * última aprobada si `approvedOnly`.
 */
export async function getLatestStudySpec(params: {
  orgId: string
  studyId: string
  approvedOnly?: boolean
}): Promise<StudySpecRow | null> {
  const tenantFilter = and(
    eq(studySpecs.organizationId, params.orgId),
    eq(studySpecs.studyId, params.studyId),
  )

  const rows = await db
    .select()
    .from(studySpecs)
    .where(
      params.approvedOnly ? and(tenantFilter, eq(studySpecs.status, 'approved')) : tenantFilter,
    )
    .orderBy(desc(studySpecs.version))
    .limit(1)

  return rows[0] ?? null
}
