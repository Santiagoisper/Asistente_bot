import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { confirmProfileProposal, ProfileProposalError } from '../../../../../../../../../../lib/subjects/patient-profile-service'
import { profileWriteErrorResponse } from '../../../../../../../../../../lib/subjects/profile-write-errors'
import { PhiConfigError } from '../../../../../../../../../../lib/subjects/phi-fields'
import { findSubjectEvolution } from '../../../../../../../../../../lib/subjects/evolution-reader'
import { profileForResponse } from '../../../../../../../../../../lib/subjects/profile-response'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST — una persona acepta lo que se extrajo de una evolución: recién ahí pasa al perfil del sujeto (R6).
 * La escritura del perfil y su registro de auditoría van en la misma transacción (R3).
 *
 * La evolución tiene que seguir vigente (D24). La propuesta se escribe unos segundos después de
 * guardar la evolución, mientras espera al modelo: si en ese rato alguien la anuló, la propuesta
 * aparece tarde y la anulación no la encontró para retirarla. Acá es donde no entra al perfil del
 * sujeto equivocado. Descartarla sigue pudiéndose. Si la anulación llega entre esta comprobación y
 * la escritura, retira la propuesta y cambia la versión del perfil: la escritura reintenta y ya no
 * la encuentra.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; subjectId: string; evolutionId: string }> },
): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params

  try {
    const { orgId, userId, study, subject } = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
    if (!UUID.test(evolutionId)) return Response.json({ error: 'no_pending_proposal' }, { status: 409 })

    const evolution = await findSubjectEvolution({ orgId, studyId: study.id, subjectId: subject.id, evolutionId }, 'with-voided')
    if (!evolution) return Response.json({ error: 'no_pending_proposal' }, { status: 409 })
    if (evolution.voided) return Response.json({ error: 'evolution_voided' }, { status: 409 })

    // La propuesta se busca en el perfil comparando texto: va el identificador que devolvió la
    // base (en minúsculas), no el de la ruta, que la base acepta también en mayúsculas.
    const profile = await confirmProfileProposal({ orgId, studyId: study.id, subjectId: subject.id, evolutionId: evolution.id, userId })

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
