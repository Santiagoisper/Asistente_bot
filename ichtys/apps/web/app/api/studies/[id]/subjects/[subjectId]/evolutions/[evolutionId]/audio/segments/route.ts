import { handleApiError, validateSubjectAccess } from '@ichtys/auth'
import { validateDictatedSegments } from '@ichtys/clinical'
import { auditedWrite } from '../../../../../../../../../../lib/audit/audited-write'
import { writeAuditLog } from '../../../../../../../../../../lib/chat/persistence'
import { findAudioForSegments, loadAudioSegments, storeAudioSegments } from '../../../../../../../../../../lib/dictation/audio-store'
import { DICTATION_AUDIO_MAX_TAKES } from '../../../../../../../../../../lib/dictation/protocol'
import { parseTake } from '../../../../../../../../../../lib/dictation/takes'
import { clinicalRateLimit } from '../../../../../../../../../../lib/security/clinical-rate-limit'
import { findSubjectEvolution, lockSubjectEvolution } from '../../../../../../../../../../lib/subjects/evolution-reader'
import { PhiConfigError } from '../../../../../../../../../../lib/subjects/phi-fields'

export const runtime = 'nodejs'

/**
 * Los tramos de lo dictado, junto a la grabación de una toma
 * (docs/decisions/enlace-frase-audio.md). Son el texto del transcriptor, sin corregir, con su
 * tiempo en la grabación: dato clínico, cifrado, que vence con la grabación.
 */
type Params = { params: Promise<{ id: string; subjectId: string; evolutionId: string }> }

class EvolutionNoLongerCurrentError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEGMENTS_ENDPOINT = '/api/studies/[id]/subjects/[subjectId]/evolutions/[evolutionId]/audio/segments'
/** Veinte minutos dictados son del orden de 20 000 letras: esto deja margen y corta lo demás. */
const SEGMENTS_BODY_MAX_CHARS = 600_000
const notFound = () => new Response('Not Found', { status: 404 })

/**
 * PUT — guarda los tramos de una toma. Solo quien dictó, después de guardar la grabación, y una
 * sola vez. El servidor no confía en lo que llega: lo que no cumple se rechaza entero y la
 * grabación queda como estaba, sin tramos.
 */
export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId, { require: 'clinical.author' })
    if (!UUID.test(evolutionId)) return notFound()
    const limited = await clinicalRateLimit('audio_write', { orgId: access.orgId, userId: access.userId, studyId: access.study.id, req, endpoint: SEGMENTS_ENDPOINT })
    if (limited) return limited
    const take = parseTake(new URL(req.url).searchParams.get('take'))
    if (take === null) return Response.json({ error: 'invalid_take', maxTakes: DICTATION_AUDIO_MAX_TAKES }, { status: 400 })

    const raw = await req.text()
    if (raw.length > SEGMENTS_BODY_MAX_CHARS) return Response.json({ error: 'segments_too_large' }, { status: 413 })
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return Response.json({ error: 'invalid_segments' }, { status: 400 })
    }

    const evolutionScope = { orgId: access.orgId, studyId: access.study.id, subjectId: access.subject.id, evolutionId }
    const evolution = await findSubjectEvolution(evolutionScope, 'current')
    if (!evolution) return notFound()
    if (evolution.authorUserId !== access.userId) return new Response('Forbidden', { status: 403 })

    const audio = await findAudioForSegments({ ...evolutionScope, take, now: new Date() })
    if (audio.state === 'missing') return notFound()
    if (audio.state !== 'ok') return Response.json({ error: audio.state === 'withdrawn' ? 'audio_withdrawn' : 'audio_expired' }, { status: 410 })
    if (audio.createdBy !== access.userId) return new Response('Forbidden', { status: 403 })

    // Los tiempos se comprueban contra la duración de la grabación guardada.
    const segments = validateDictatedSegments((body as { segments?: unknown } | null)?.segments, audio.durationSec)
    if (!segments) return Response.json({ error: 'invalid_segments' }, { status: 400 })
    if (audio.hasSegments) return Response.json({ error: 'segments_already_stored' }, { status: 409 })

    const stored = await auditedWrite(
      async (tx) => {
        // Igual que la grabación: si la evolución se anuló mientras tanto, no se guarda nada (D24).
        const stillThere = await lockSubjectEvolution(evolutionScope, 'share', tx)
        if (!stillThere || !(await findSubjectEvolution(evolutionScope, 'current', tx))) throw new EvolutionNoLongerCurrentError()
        return storeAudioSegments(tx, { orgId: access.orgId, audioId: audio.id, segments })
      },
      (result) => ({
        action: 'evolution.audio.segments.store',
        orgId: access.orgId,
        studyId: access.study.id,
        userId: access.userId,
        resourceType: 'dictation_audio',
        resourceId: audio.id,
        // Sin el texto: cuántos tramos y de qué toma.
        metadata: { subjectId: access.subject.id, evolutionId: evolution.id, take, count: segments.length, stored: result },
      }),
    )
    if (!stored) return Response.json({ error: 'segments_already_stored' }, { status: 409 })
    return Response.json({ count: segments.length }, { status: 201 })
  } catch (err) {
    if (err instanceof EvolutionNoLongerCurrentError) return notFound()
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    return handleApiError(err)
  }
}

/**
 * GET — los tramos de una toma, para quien puede escuchar su grabación. Leerlos es leer lo
 * dictado: queda registrado quién, sin el texto.
 */
export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { id: routeStudyId, subjectId, evolutionId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId)
    if (!UUID.test(evolutionId)) return notFound()
    const limited = await clinicalRateLimit('audio_listen', { orgId: access.orgId, userId: access.userId, studyId: access.study.id, req, endpoint: SEGMENTS_ENDPOINT })
    if (limited) return limited
    const take = parseTake(new URL(req.url).searchParams.get('take'))
    if (take === null) return notFound()

    const loaded = await loadAudioSegments({ orgId: access.orgId, studyId: access.study.id, subjectId: access.subject.id, evolutionId, take, now: new Date() })
    if (loaded.state === 'missing' || loaded.state === 'none') return notFound()
    if (loaded.state !== 'ok') return Response.json({ error: loaded.state === 'withdrawn' ? 'audio_withdrawn' : 'audio_expired' }, { status: 410 })

    // El registro va antes de entregar: si no se puede registrar, no se entrega.
    await writeAuditLog({
      action: 'evolution.audio.segments.read',
      orgId: access.orgId,
      studyId: access.study.id,
      userId: access.userId,
      resourceType: 'dictation_audio',
      resourceId: loaded.id,
      metadata: { subjectId: access.subject.id, evolutionId, take, count: loaded.segments.length },
    })
    return Response.json({ segments: loaded.segments }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof PhiConfigError) return Response.json({ error: 'phi_encryption_not_configured' }, { status: 503 })
    return handleApiError(err)
  }
}
