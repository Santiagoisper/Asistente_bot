import { handleApiError, validateSubjectAccess } from '@ichtys/auth'
import { DICTATION_AUDIO_RETENTION_DAYS, listSubjectAudios } from '../../../../../../../lib/dictation/audio-store'

export const runtime = 'nodejs'

/**
 * GET — qué evoluciones de este sujeto tienen grabación y hasta cuándo. Sin contenido:
 * la pantalla lo usa para ofrecer «escuchar» y para decir cuándo se borra.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; subjectId: string }> }): Promise<Response> {
  const { id: routeStudyId, subjectId } = await params
  try {
    const access = await validateSubjectAccess(subjectId, routeStudyId)
    const audios = await listSubjectAudios({
      orgId: access.orgId,
      studyId: access.study.id,
      subjectId: access.subject.id,
      now: new Date(),
    })
    return Response.json({
      retentionDays: DICTATION_AUDIO_RETENTION_DAYS,
      audios: audios.map((audio) => ({ ...audio, expiresAt: audio.expiresAt.toISOString() })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
