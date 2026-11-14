import { AccessError, handleApiError, validatePhiStudyAccess } from '@ichtys/auth'
import { resolveOrgAccessContext } from '../../../../lib/access/org-context'
import { listUnassignedAudiosByAuthor } from '../../../../lib/dictation/audio-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — las grabaciones sin sujeto de quien llama
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 3).
 *
 * - **Por ahora, solo las propias:** las que esta persona grabó. Que también las vea «quien
 *   coordina el estudio» espera una decisión: en modo `open` esa comprobación no distingue a
 *   nadie, y esto es la voz de una persona.
 * - **Tiene que conservar el acceso al estudio:** la grabación sigue siendo de un estudio. Se
 *   comprueba una vez por estudio; la de un estudio al que ya no entra no aparece.
 * - Sin contenido y sin sujeto: la tabla no guarda de qué sujeto se retiró, a propósito.
 */
export async function GET(): Promise<Response> {
  try {
    const { orgId, userId } = await resolveOrgAccessContext()
    const now = new Date()
    // El filtro por persona va en la consulta; acá se repite para que no dependa solo de ella.
    const own = (await listUnassignedAudiosByAuthor({ orgId, userId })).filter((row) => row.createdBy === userId)

    const studyNames = new Map<string, string>()
    const denied = new Set<string>()
    for (const row of own) {
      if (studyNames.has(row.studyId) || denied.has(row.studyId)) continue
      try {
        const access = await validatePhiStudyAccess(row.studyId)
        studyNames.set(row.studyId, access.study.name)
      } catch (err) {
        // Solo un acceso negado saca al estudio de la lista. Cualquier otro fallo sube:
        // una lista a medias diría «no tenés ninguna» sin saberlo.
        if (!(err instanceof AccessError) || (err.status !== 403 && err.status !== 404)) throw err
        denied.add(row.studyId)
      }
    }

    const audios = own
      .filter((row) => studyNames.has(row.studyId))
      .map((row) => ({
        id: row.id,
        studyId: row.studyId,
        studyName: studyNames.get(row.studyId),
        take: row.take,
        durationSec: row.durationSec,
        recordedAt: row.createdAt.toISOString(),
        withdrawnAt: row.declaredAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        // Una vencida no se escucha aunque la limpieza diaria todavía no haya pasado.
        available: row.purgedAt === null && row.expiresAt > now,
      }))
    return Response.json({ audios })
  } catch (err) {
    return handleApiError(err)
  }
}
