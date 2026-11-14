import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestStudySpec } from '@ichtys/ingestion/spec-store'
import { loadPatientProfileState } from '../../../../../../../lib/subjects/patient-profile-service'
import { evaluateAndPersistScreening } from '../../../../../../../lib/subjects/screening-service'
import { PhiConfigError } from '../../../../../../../lib/subjects/phi-fields'
import { guideVisits } from '../../../../../../../lib/subjects/guide-visits'

export const runtime = 'nodejs'

/** GET — screening determinista vs spec del protocolo (Fase 2.5). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId)

    const { profile, unreadable: profileUnreadable } = await loadPatientProfileState({
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
        profileUnreadable,
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
        profileUnreadable,
        protocolDocumentId: null,
        message: 'El study spec no es válido.',
      })
    }

    // Un perfil que no se pudo leer llega acá vacío. Evaluarlo daría todo «a revisar» y
    // dejaría guardada esa evaluación como si fuera la del sujeto: no se evalúa ni se guarda.
    if (profileUnreadable) {
      return Response.json({
        subjectCode: subject.subjectCode,
        profile,
        assessments: [],
        summary: { pass: 0, fail: 0, unknown: 0 },
        specAvailable: true,
        profileUnreadable: true,
        specVersion: specRow.version,
        specStatus: specRow.status,
        protocolDocumentId: null,
        visits: guideVisits(parsedSpec.data),
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
      // El registro lo escribe el servicio: junto con la instantánea si guarda una, o como lectura si no.
      audit: (facts) => ({
        action: 'screening.view',
        orgId,
        studyId: study.id,
        userId,
        resourceType: 'subject',
        resourceId: subject.id,
        metadata: {
          pass: facts.summary.pass,
          fail: facts.summary.fail,
          unknown: facts.summary.unknown,
          snapshotId: facts.snapshotId,
          snapshotCreated: facts.snapshotCreated,
        },
      }),
    })

    return Response.json({
      subjectCode: subject.subjectCode,
      profile,
      assessments: evaluation.assessments,
      summary: evaluation.summary,
      specAvailable: true,
      profileUnreadable: false,
      specVersion: evaluation.specVersion,
      specStatus: specRow.status,
      protocolDocumentId: evaluation.protocolDocumentId,
      // El cronograma del protocolo, para que la guía muestre los procedimientos de la visita (D21).
      visits: guideVisits(parsedSpec.data),
    })
  } catch (err) {
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
