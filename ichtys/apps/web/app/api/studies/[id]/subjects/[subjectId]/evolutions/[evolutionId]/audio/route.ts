import { handleApiError, validateSubjectAccess } from '@ichtys/auth'
import { auditedWrite, insertAuditLog } from '../../../../../../../../../lib/audit/audited-write'
import { writeAuditLog } from '../../../../../../../../../lib/chat/persistence'
import {
  DICTATION_AUDIO_MAX_BYTES,
  baseMime,
  findEvolution,
  loadDictationAudio,
  purgeExpiredDictationAudios,
  storeDictationAudio,
} from '../../../../../../../../../lib/dictation/audio-store'
import { PhiConfigError } from '../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; subjectId: string; evolutionId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Lo mismo que para una evolución que no existe: no se confirma nada a quien no corresponde. */
const notFound = () => new Response('Not Found', { status: 404 })

/**
 * POST — guarda la grabación de una evolución dictada (docs/decisions/consulta-dictada.md, D14).
 * Solo quien escribió la evolución, y una sola vez. El cuerpo es el audio; el tipo va en
 * Content-Type y la duración en X-Duration-Sec.
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
    if (!UUID.test(evolutionId)) return notFound()

    const mime = baseMime(req.headers.get('content-type'))
    if (!mime) return Response.json({ error: 'unsupported_audio_type' }, { status: 415 })
    const durationSec = Number(req.headers.get('x-duration-sec'))
    if (!Number.isInteger(durationSec) || durationSec < 0 || durationSec > 4 * 60 * 60) {
      return Response.json({ error: 'invalid_duration' }, { status: 400 })
    }
    const declared = Number(req.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > DICTATION_AUDIO_MAX_BYTES) {
      return Response.json({ error: 'audio_too_large', maxBytes: DICTATION_AUDIO_MAX_BYTES }, { status: 413 })
    }

    const evolution = await findEvolution({
      orgId: access.orgId,
      studyId: access.study.id,
      subjectId: access.subject.id,
      evolutionId,
    })
    if (!evolution) return notFound()
    // La grabación la adjunta quien dictó: nadie le cuelga un audio a la evolución de otra persona.
    if (evolution.authorUserId !== access.userId) return new Response('Forbidden', { status: 403 })

    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength === 0) return Response.json({ error: 'empty_audio' }, { status: 400 })
    if (bytes.byteLength > DICTATION_AUDIO_MAX_BYTES) {
      return Response.json({ error: 'audio_too_large', maxBytes: DICTATION_AUDIO_MAX_BYTES }, { status: 413 })
    }

    const now = new Date()
    const stored = await auditedWrite(
      async (tx) => {
        // De paso se limpia lo vencido: la conservación no depende solo de la tarea diaria.
        const purged = await purgeExpiredDictationAudios(tx, now)
        for (const audio of purged) {
          await insertAuditLog(tx, {
            action: 'evolution.audio.purge',
            orgId: audio.organizationId,
            studyId: audio.studyId,
            userId: 'system:retention',
            resourceType: 'dictation_audio',
            resourceId: audio.id,
            metadata: { reason: 'expired' },
          })
        }
        return storeDictationAudio(tx, {
          orgId: access.orgId,
          studyId: access.study.id,
          subjectId: access.subject.id,
          evolutionId: evolution.id,
          actorId: access.userId,
          mime,
          durationSec,
          bytes,
          now,
        })
      },
      (result) => ({
        action: 'evolution.audio.store',
        orgId: access.orgId,
        studyId: access.study.id,
        userId: access.userId,
        resourceType: 'dictation_audio',
        resourceId: result?.id ?? evolution.id,
        // Sin contenido: tamaño, duración, tipo y huella.
        metadata: {
          subjectId: access.subject.id,
          evolutionId: evolution.id,
          stored: result !== null,
          mime,
          durationSec,
          sizeBytes: bytes.byteLength,
          sha256: result?.sha256 ?? null,
          expiresAt: result?.expiresAt.toISOString() ?? null,
        },
      }),
    )

    if (!stored) return Response.json({ error: 'audio_already_stored' }, { status: 409 })
    return Response.json({ id: stored.id, sha256: stored.sha256, expiresAt: stored.expiresAt.toISOString() }, { status: 201 })
  } catch (err) {
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    return handleApiError(err)
  }
}

/** GET — entrega la grabación a quien puede ver los datos clínicos del sujeto. Queda registrado quién la escuchó. */
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId)
    if (!UUID.test(evolutionId)) return notFound()

    const audio = await loadDictationAudio({
      orgId: access.orgId,
      studyId: access.study.id,
      subjectId: access.subject.id,
      evolutionId,
      now: new Date(),
    })
    if (audio.state === 'missing') return notFound()
    if (audio.state === 'expired') return Response.json({ error: 'audio_expired' }, { status: 410 })

    // El registro va antes de entregar: si no se puede registrar, no se entrega.
    await writeAuditLog({
      action: 'evolution.audio.listen',
      orgId: access.orgId,
      studyId: access.study.id,
      userId: access.userId,
      resourceType: 'dictation_audio',
      resourceId: audio.id,
      metadata: { subjectId: access.subject.id, evolutionId },
    })

    return new Response(audio.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': audio.mime,
        'Content-Length': String(audio.bytes.byteLength),
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
