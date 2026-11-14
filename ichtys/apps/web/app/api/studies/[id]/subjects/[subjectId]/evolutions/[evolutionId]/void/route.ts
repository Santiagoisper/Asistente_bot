import { handleApiError, validateSubjectAccess } from '@ichtys/auth'
import { db } from '@ichtys/db'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../../../lib/api/body-limit'
import { clinicalRateLimit } from '../../../../../../../../../lib/security/clinical-rate-limit'
import { findSubjectEvolution } from '../../../../../../../../../lib/subjects/evolution-reader'
import { voidEvolution } from '../../../../../../../../../lib/subjects/evolution-void'
import { txVoidStore } from '../../../../../../../../../lib/subjects/evolution-void-store'
import { ProfileUnreadableError, retireProposalOfVoidedEvolution } from '../../../../../../../../../lib/subjects/patient-profile-service'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'
import { voidEvolutionInput } from '../../../../../../../../../lib/subjects/schemas'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; subjectId: string; evolutionId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENDPOINT = '/api/studies/[id]/subjects/[subjectId]/evolutions/[evolutionId]/void'

const notFound = () => new Response('Not Found', { status: 404 })

/**
 * POST — declara que la evolución se registró en el sujeto equivocado
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
 *
 * - **Quién puede:** quien escribió la evolución, o quien coordina el estudio (la capacidad
 *   `access.manage_study`: Study Coordinator y Dirección de Operaciones). Nadie más.
 * - **Es definitivo.** No hay forma de desanular (Santiago, 14/11/2026).
 * - Anular, retirar las grabaciones al depósito y retirar la propuesta pendiente del perfil que
 *   salió de esa evolución van en una transacción: o pasa todo, o no pasa nada.
 * - Alphi no lo hace solo: lo declara una persona, que confirma el sujeto.
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId)
    if (!UUID.test(evolutionId)) return notFound()

    // Después del acceso (hace falta saber quién es) y antes de leer el cuerpo.
    const limited = await clinicalRateLimit('evolution_write', { orgId: access.orgId, userId: access.userId, studyId: access.study.id, req, endpoint: ENDPOINT })
    if (limited) return limited

    // Primero quién es y qué puede; recién después, lo que mandó. Así ninguna respuesta que
    // dependa del cuerpo le llega a quien no puede anular (observación de Architect, #173).
    const scope = { orgId: access.orgId, studyId: access.study.id, subjectId: access.subject.id, evolutionId }
    const evolution = await findSubjectEvolution(scope, 'with-voided')
    if (!evolution) return notFound()

    // Quien no la escribió necesita coordinar el estudio. El validador responde 403 si no.
    // Quien la escribió puede siempre, aunque hoy ya no tenga la función de escribir evoluciones:
    // la responsabilidad por lo que escribió no se le va con el cambio de función (D24, punto 1).
    if (evolution.authorUserId !== access.userId) {
      await validateSubjectAccess(subjectId, routeStudyId, { require: 'access.manage_study' })
    }

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
      return new Response('Bad Request', { status: 400 })
    }
    const parsed = voidEvolutionInput.safeParse(body)
    if (!parsed.success) return new Response('Bad Request', { status: 400 })

    if (parsed.data.confirmedSubjectCode !== access.subject.subjectCode) {
      return Response.json({ error: 'subject_mismatch' }, { status: 409 })
    }
    if (evolution.voided) return Response.json({ error: 'already_voided' }, { status: 409 })

    const outcome = await db.transaction(async (tx) => {
      const result = await voidEvolution(txVoidStore(tx, scope), {
        ...scope,
        actorId: access.userId,
        reason: parsed.data.reason,
        note: parsed.data.note,
        now: new Date(),
      })
      if (result.status !== 'voided') return { result, proposalRetired: false }
      // Lo que Alphi propuso para el perfil a partir de esta evolución deja de estar pendiente.
      const proposalRetired = await retireProposalOfVoidedEvolution(tx, {
        orgId: scope.orgId,
        studyId: scope.studyId,
        subjectId: scope.subjectId,
        evolutionId,
        userId: access.userId,
      })
      return { result, proposalRetired }
    })

    if (outcome.result.status === 'not_found') return notFound()
    if (outcome.result.status === 'already_voided') return Response.json({ error: 'already_voided' }, { status: 409 })
    return Response.json({ status: 'voided', withdrawnAudios: outcome.result.withdrawn.length, proposalRetired: outcome.proposalRetired })
  } catch (err) {
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    // No se pudo leer el perfil para saber si había una propuesta pendiente: no se anula a ciegas.
    if (err instanceof ProfileUnreadableError) return Response.json({ error: 'profile_unreadable' }, { status: 422 })
    return handleApiError(err)
  }
}
