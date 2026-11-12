import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { rejectProfileProposal, ProfileProposalError } from '../../../../../../../../../../lib/subjects/patient-profile-service'
import { PhiConfigError } from '../../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST — una persona descarta lo que se extrajo de una evolución: el perfil queda como estaba (R6).
 * La escritura del perfil y su registro de auditoría van en la misma transacción (R3).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; evolutionId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
    if (!UUID.test(evolutionId)) return Response.json({ error: 'no_pending_proposal' }, { status: 409 })

    const profile = await rejectProfileProposal({ orgId, studyId: study.id, subjectId: subject.id, evolutionId, userId })

    return Response.json({ subjectCode: subject.subjectCode, profile })
  } catch (err) {
    if (err instanceof ProfileProposalError) {
      return Response.json({ error: err.code }, { status: 409 })
    }
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
