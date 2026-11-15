import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { rejectProfileProposal, ProfileProposalError } from '../../../../../../../../../../lib/subjects/patient-profile-service'
import { profileWriteErrorResponse } from '../../../../../../../../../../lib/subjects/profile-write-errors'
import { PhiConfigError } from '../../../../../../../../../../lib/subjects/phi-fields'
import { profileForResponse } from '../../../../../../../../../../lib/subjects/profile-response'
import { parseRouteUuid } from '../../../../../../../../../../lib/api/route-uuid'

export const runtime = 'nodejs'


/**
 * POST — una persona descarta lo que se extrajo de una evolución: el perfil queda como estaba (R6).
 * La escritura del perfil y su registro de auditoría van en la misma transacción (R3).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; evolutionId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId: rawEvolutionId } = await params
  const evolutionId = parseRouteUuid(rawEvolutionId)

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
    if (!evolutionId) return Response.json({ error: 'no_pending_proposal' }, { status: 409 })

    // La propuesta se busca en el perfil comparando texto, y ahí el identificador está como lo
    // devuelve la base: en minúsculas. Esta ruta no lee la evolución (descartar se puede siempre),
    // así que lo pasa a minúsculas en vez de tomarlo de la base.
    const profile = await rejectProfileProposal({ orgId, studyId: study.id, subjectId: subject.id, evolutionId, userId })

    return Response.json({ subjectCode: subject.subjectCode, profile: profileForResponse(profile) })
  } catch (err) {
    const profileError = profileWriteErrorResponse(err)
    if (profileError) return profileError
    if (err instanceof ProfileProposalError) {
      return Response.json({ error: err.code }, { status: 409 })
    }
    if (err instanceof PhiConfigError) {
      return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    }
    return handleApiError(err)
  }
}
