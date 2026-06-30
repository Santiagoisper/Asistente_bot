import { assessScreening, screeningSummary } from '@ichtys/clinical'
import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestStudySpec } from '@ichtys/ingestion/spec-store'
import { writeAuditLog } from '../../../../../../../lib/chat/persistence'
import { loadPatientProfile } from '../../../../../../../lib/subjects/patient-profile-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/** GET — screening determinista vs spec del protocolo (Fase 2). */
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
        message: 'El study spec no es válido.',
      })
    }

    const assessments = assessScreening(profile, {
      inclusionCriteria: parsedSpec.data.inclusionCriteria.map((c) => ({
        number: c.number,
        text: c.text,
      })),
      exclusionCriteria: parsedSpec.data.exclusionCriteria.map((c) => ({
        number: c.number,
        text: c.text,
      })),
    })

    const summary = screeningSummary(assessments)

    await writeAuditLog({
      action: 'screening.view',
      orgId,
      studyId: study.id,
      userId,
      resourceType: 'subject',
      resourceId: subject.id,
      metadata: { pass: summary.pass, fail: summary.fail, unknown: summary.unknown },
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      profile,
      assessments,
      summary,
      specAvailable: true,
      specVersion: specRow.version,
      specStatus: specRow.status,
    })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
