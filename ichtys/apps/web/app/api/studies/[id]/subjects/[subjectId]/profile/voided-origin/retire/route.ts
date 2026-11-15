import { validateSubjectAccess, handleApiError } from '@ichtys/auth'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../../../lib/api/body-limit'
import { clinicalRateLimit } from '../../../../../../../../../lib/security/clinical-rate-limit'
import { findSubjectEvolution } from '../../../../../../../../../lib/subjects/evolution-reader'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'
import { profileForResponse } from '../../../../../../../../../lib/subjects/profile-response'
import { profileWriteErrorResponse } from '../../../../../../../../../lib/subjects/profile-write-errors'
import { retireVoidedOriginInput } from '../../../../../../../../../lib/subjects/schemas'
import { RetireSelectionError } from '../../../../../../../../../lib/subjects/voided-origin-retire'
import { retireVoidedOriginFacts } from '../../../../../../../../../lib/subjects/voided-origin-retire-service'

export const runtime = 'nodejs'

const ENDPOINT = '/api/studies/[id]/subjects/[subjectId]/profile/voided-origin/retire'

/**
 * POST — una persona retira del perfil lo que entró desde una evolución anulada
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, punto 4 bis).
 *
 * - **Quién:** quien puede escribir el perfil de este sujeto (`clinical.author`). Coordinar el
 *   estudio alcanza para anular una evolución, no para decidir qué dato clínico sale.
 * - **Sobre qué:** una evolución anulada de este sujeto. No es un editor general del perfil.
 * - Los laboratorios de ese origen salen todos; el resto, lo que la persona eligió.
 * - Una revisión que no saca nada vale solo si la persona lo declara (`nothingToRetire`): apagar
 *   el aviso no puede ser lo que pasa por defecto.
 * - Lo retirado se conserva dentro del perfil cifrado y no viaja en la respuesta.
 * - Alphi no lo hace solo: lo decide una persona, que confirma el sujeto.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; subjectId: string }> }): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })

    // Después del acceso (hace falta saber quién es) y antes de leer el cuerpo.
    const limited = await clinicalRateLimit('evolution_write', { orgId: access.orgId, userId: access.userId, studyId: access.study.id, req, endpoint: ENDPOINT })
    if (limited) return limited

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
      return new Response('Bad Request', { status: 400 })
    }
    const parsed = retireVoidedOriginInput.safeParse(body)
    if (!parsed.success) return new Response('Bad Request', { status: 400 })

    if (parsed.data.confirmedSubjectCode !== access.subject.subjectCode) {
      return Response.json({ error: 'subject_mismatch' }, { status: 409 })
    }

    const scope = { orgId: access.orgId, studyId: access.study.id, subjectId: access.subject.id }
    const evolution = await findSubjectEvolution({ ...scope, evolutionId: parsed.data.evolutionId }, 'with-voided')
    if (!evolution) return new Response('Not Found', { status: 404 })
    if (!evolution.voided) return Response.json({ error: 'evolution_not_voided' }, { status: 409 })

    // Al servicio va el identificador que devolvió la base, no el que llegó en el pedido: la base
    // lo compara como `uuid` y no distingue mayúsculas; el perfil guarda texto y sí las distingue.
    // Con el del pedido en mayúsculas no coincidía con el origen de ningún laboratorio.
    const result = await retireVoidedOriginFacts({
      ...scope,
      evolutionId: evolution.id,
      userId: access.userId,
      removeAge: parsed.data.removeAge ?? false,
      removeBloodPressure: parsed.data.removeBloodPressure ?? false,
      medications: parsed.data.medications ?? [],
      conditions: parsed.data.conditions ?? [],
      nothingToRetire: parsed.data.nothingToRetire ?? false,
    })

    return Response.json({ subjectCode: access.subject.subjectCode, profile: profileForResponse(result.profile), retired: result.removed })
  } catch (err) {
    // Sin elegir nada y sin declararlo es un pedido incompleto; lo demás es un perfil que cambió.
    if (err instanceof RetireSelectionError) return Response.json({ error: err.code }, { status: err.code === 'selection_required' ? 400 : 409 })
    const profileError = profileWriteErrorResponse(err)
    if (profileError) return profileError
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    return handleApiError(err)
  }
}
