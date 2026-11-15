import { handleApiError, validatePhiStudyAccess } from '@ichtys/auth'
import { resolveOrgAccessContext } from '../../../../../lib/access/org-context'
import { coordinatesStudy } from '../../../../../lib/access/permissions'
import { writeAuditLog } from '../../../../../lib/chat/persistence'
import { findUnassignedAudio, loadUnassignedAudioBytes } from '../../../../../lib/dictation/audio-store'
import { clinicalRateLimit } from '../../../../../lib/security/clinical-rate-limit'
import { PhiConfigError } from '../../../../../lib/subjects/phi-fields'
import { parseRouteUuid } from '../../../../../lib/api/route-uuid'

export const runtime = 'nodejs'

type Params = { params: Promise<{ audioId: string }> }

const ENDPOINT = '/api/dictation-audios/unassigned/[audioId]'
/** Lo mismo para la que no existe y para la que no le corresponde: no se confirma nada. */
const notFound = () => new Response('Not Found', { status: 404 })
const expired = () => Response.json({ error: 'audio_expired' }, { status: 410 })

/**
 * GET — entrega una grabación sin sujeto a quien la grabó o a quien coordina el estudio
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 3).
 *
 * Sigue siendo dato clínico: mismo cuidado que la grabación de una evolución. La escucha quien
 * la grabó, si conserva el acceso al estudio; cada escucha queda registrada antes de entregar;
 * una vencida no se entrega. También la escucha quien coordina el estudio, y el registro dice
 * cuál de los dos fue.
 */
export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { audioId: rawAudioId } = await params
  const audioId = parseRouteUuid(rawAudioId)
  try {
    const { orgId, userId, access } = await resolveOrgAccessContext()
    if (!audioId) return notFound()

    const audio = await findUnassignedAudio({ orgId, id: audioId })
    if (!audio) return notFound()
    // La escucha quien la grabó, o quien coordina el estudio (que también distingue en modo `open`).
    const listenerRole = audio.createdBy === userId ? 'author' : coordinatesStudy(access) ? 'coordination' : null
    if (!listenerRole) return notFound()

    // La grabación sigue siendo de un estudio: quien ya no entra en él no la escucha.
    await validatePhiStudyAccess(audio.studyId)

    // Límite de pedidos, antes de descifrar y de registrar la escucha.
    const limited = await clinicalRateLimit('audio_listen', { orgId, userId, studyId: audio.studyId, req, endpoint: ENDPOINT })
    if (limited) return limited

    if (audio.purgedAt !== null || audio.expiresAt <= new Date()) return expired()
    const bytes = await loadUnassignedAudioBytes({ orgId, id: audio.id })
    if (!bytes) return expired()

    // El registro va antes de entregar: si no se puede registrar, no se entrega.
    await writeAuditLog({
      action: 'evolution.audio.listen',
      orgId,
      studyId: audio.studyId,
      userId,
      resourceType: 'unassigned_dictation_audio',
      resourceId: audio.id,
      // Quién escuchó la voz: quien la grabó, o la coordinación del estudio.
      metadata: { evolutionId: audio.evolutionId, take: audio.take, unassigned: true, listenerRole },
    })

    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': audio.mime,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    return handleApiError(err)
  }
}
