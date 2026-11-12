import {
  assessScreening,
  criterionAssessmentSchema,
  screeningSummary,
  type CriterionAssessment,
  type PatientProfile,
} from '@ichtys/clinical'
import { and, db, desc, documentVersions, eq, patientProfiles, screeningAssessments } from '@ichtys/db'
import type { StudySpec } from '@ichtys/ingestion/study-spec'
import { insertAuditLog } from '../audit/audited-write'
import { writeAuditLog, type AuditLogParams } from '../chat/persistence'

export interface ScreeningEvaluationResult {
  assessments: CriterionAssessment[]
  summary: ReturnType<typeof screeningSummary>
  specVersion: number
  protocolDocumentId: string | null
  profileUpdatedAt: Date
  persistedSnapshotId: string | null
}

/** Lo que el registro de auditoría puede contar de una evaluación: cifras e identificadores, nunca valores clínicos. */
export interface ScreeningAuditFacts {
  summary: ReturnType<typeof screeningSummary>
  snapshotId: string | null
  /** `true` si esta consulta guardó una instantánea nueva. */
  snapshotCreated: boolean
}

/** Texto canónico de un valor JSON: mismas claves en cualquier orden dan el mismo texto (JSONB no conserva el orden). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function mapCriteria(spec: StudySpec) {
  return {
    inclusionCriteria: spec.inclusionCriteria.map((c) => ({
      number: c.number,
      text: c.text,
      sourcePages: c.sourcePages,
    })),
    exclusionCriteria: spec.exclusionCriteria.map((c) => ({
      number: c.number,
      text: c.text,
      sourcePages: c.sourcePages,
    })),
  }
}

export async function evaluateAndPersistScreening(params: {
  orgId: string
  studyId: string
  subjectId: string
  profile: PatientProfile
  spec: StudySpec
  specVersion: number
  documentVersionId: string
  /** Arma el registro de la consulta. Se escribe siempre, una sola vez. */
  audit: (facts: ScreeningAuditFacts) => AuditLogParams
}): Promise<ScreeningEvaluationResult> {
  const assessments = assessScreening(params.profile, mapCriteria(params.spec))
  const summary = screeningSummary(assessments)

  const profileRow = await db.query.patientProfiles.findFirst({
    where: and(
      eq(patientProfiles.organizationId, params.orgId),
      eq(patientProfiles.studyId, params.studyId),
      eq(patientProfiles.subjectId, params.subjectId),
    ),
    columns: { updatedAt: true },
  })
  const profileUpdatedAt = profileRow?.updatedAt ?? new Date()

  const lastSnapshot = await db.query.screeningAssessments.findFirst({
    where: and(
      eq(screeningAssessments.organizationId, params.orgId),
      eq(screeningAssessments.studyId, params.studyId),
      eq(screeningAssessments.subjectId, params.subjectId),
    ),
    orderBy: [desc(screeningAssessments.createdAt)],
  })

  const validated = assessments.map((a) => criterionAssessmentSchema.parse(a))
  // El perfil cambia de versión también cuando solo se suma o se descarta una
  // propuesta sin aceptar, que el motor no mira. Una evaluación idéntica a la
  // última, con el mismo protocolo, no es una instantánea nueva.
  const sameResult = lastSnapshot !== undefined && canonical(lastSnapshot.assessments) === canonical(validated)
  const needsPersist =
    !lastSnapshot ||
    lastSnapshot.studySpecVersion !== params.specVersion ||
    (lastSnapshot.profileUpdatedAt.getTime() < profileUpdatedAt.getTime() && !sameResult)

  let persistedSnapshotId: string | null = lastSnapshot?.id ?? null

  if (needsPersist) {
    // La instantánea y su registro se confirman juntos o no se confirma ninguno (R3).
    persistedSnapshotId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(screeningAssessments)
        .values({
          organizationId: params.orgId,
          studyId: params.studyId,
          subjectId: params.subjectId,
          studySpecVersion: params.specVersion,
          profileUpdatedAt,
          assessments: validated,
          summary,
        })
        .returning({ id: screeningAssessments.id })
      const snapshotId = inserted?.id ?? null
      await insertAuditLog(tx, params.audit({ summary, snapshotId, snapshotCreated: true }))
      return snapshotId
    })
  } else {
    // No se escribió nada: es una lectura, y se registra antes de entregarla.
    await writeAuditLog(params.audit({ summary, snapshotId: persistedSnapshotId, snapshotCreated: false }))
  }

  const docVersion = await db.query.documentVersions.findFirst({
    where: eq(documentVersions.id, params.documentVersionId),
    columns: { documentId: true },
  })

  return {
    assessments,
    summary,
    specVersion: params.specVersion,
    protocolDocumentId: docVersion?.documentId ?? null,
    profileUpdatedAt,
    persistedSnapshotId,
  }
}
