import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestStudySpec } from '@ichtys/ingestion/spec-store'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import { loadPatientProfile } from '../../../../../../../lib/subjects/patient-profile-service'
import { evaluateAndPersistScreening } from '../../../../../../../lib/subjects/screening-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/** GET — screening determinista vs spec del protocolo (Fase 2.5). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId)

    const profile = await loadPatientProfile({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
    })

    const specRow = await getLatestStudySpec({ orgId, studyId: study.id, approvedOnly: false })
    if (!specRow) {
      return Response.json({
        subjectCode: subject.subjectCode,
        profile,
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: false,
        protocolDocumentId: null,
        message: 'No hay study spec extraído para este estudio.',
      })
    }

    const parsedSpec = studySpecSchema.safeParse(specRow.spec)
    if (!parsedSpec.success) {
      return Response.json({
        subjectCode: subject.subjectCode,
        profile,
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: false,
        protocolDocumentId: null,
        message: 'El study spec no es válido.',
      })
    }

    const evaluation = await evaluateAndPersistScreening({
      orgId,
      studyId: study.id,
      subjectId: subject.id,
      profile,
      spec: parsedSpec.data,
      specVersion: specRow.version,
      documentVersionId: specRow.documentVersionId,
    })

    await writeAuditLog({
      action: 'screening.view',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: {
        pass: evaluation.summary.pass,
        fail: evaluation.summary.fail,
        unknown: evaluation.summary.unknown,
        snapshotId: evaluation.persistedSnapshotId,
      },
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      profile,
      assessments: evaluation.assessments,
      summary: evaluation.summary,
      specAvailable: true,
      specVersion: evaluation.specVersion,
      specStatus: specRow.status,
      protocolDocumentId: evaluation.protocolDocumentId,
    })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
