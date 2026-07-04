import {
  assessScreening,
  criterionAssessmentSchema,
  screeningSummary,
  type CriterionAssessment,
  type PatientProfile,
} from '@ichtys/clinical'
import { and, db, desc, documentVersions, eq, patientProfiles, screeningAssessments } from '@ichtys/db'
import type { StudySpec } from '@ichtys/ingestion/study-spec'

export interface ScreeningEvaluationResult {
  assessments: CriterionAssessment[]
  summary: ReturnType<typeof screeningSummary>
  specVersion: number
  protocolDocumentId: string | null
  profileUpdatedAt: Date
  persistedSnapshotId: string | null
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

  const needsPersist =
    !lastSnapshot ||
    lastSnapshot.studySpecVersion !== params.specVersion ||
    lastSnapshot.profileUpdatedAt.getTime() < profileUpdatedAt.getTime()

  let persistedSnapshotId: string | null = lastSnapshot?.id ?? null

  if (needsPersist) {
    const validated = assessments.map((a) => criterionAssessmentSchema.parse(a))
    const [inserted] = await db
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
    persistedSnapshotId = inserted?.id ?? null
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
