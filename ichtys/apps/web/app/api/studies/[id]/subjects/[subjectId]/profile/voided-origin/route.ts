import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { listAcceptedProposalEvolutionIds, listVoidedEvolutionIds } from '../../../../../../../../lib/subjects/voided-origin-store'

export const runtime = 'nodejs'

/**
 * GET — de qué evoluciones anuladas de este sujeto entró algo al perfil (D24, punto 2).
 *
 * Devuelve solo identificadores de evolución: ni datos del perfil ni texto. Con eso y con el
 * perfil que ya tiene, la pantalla arma el aviso. Si la consulta falla responde error: una
 * lista vacía se leería como «no hay nada que avisar».
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; subjectId: string }> }): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId)
    const scope = { orgId: access.orgId, studyId: access.study.id, subjectId: access.subject.id }

    const voided = await listVoidedEvolutionIds(scope)
    if (voided.length === 0) return Response.json({ acceptedFrom: [] })

    const accepted = await listAcceptedProposalEvolutionIds(scope, voided)
    return Response.json({ acceptedFrom: accepted.filter((evolutionId) => voided.includes(evolutionId)) })
  } catch (err) {
    return handleApiError(err)
  }
}
