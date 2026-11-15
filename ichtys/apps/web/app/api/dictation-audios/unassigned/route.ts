import { AccessError, handleApiError, validatePhiStudyAccess } from '@ichtys/auth'
import { resolveOrgAccessContext } from '../../../../lib/access/org-context'
import { coordinatesStudy } from '../../../../lib/access/permissions'
import {
  UNASSIGNED_AUDIO_LIST_MAX,
  listUnassignedAudioStudiesByAuthor,
  listUnassignedAudioStudiesOfOrg,
  listUnassignedAudiosByAuthor,
  listUnassignedAudiosOfOrg,
} from '../../../../lib/dictation/audio-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — las grabaciones sin sujeto de quien llama
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 3).
 *
 * - **Las propias, siempre.** Las que esta persona grabó.
 * - **Las de otras personas, solo a quien coordina** (`coordinatesStudy`, que también distingue
 *   en modo `open`). Sin eso, la grabación de quien perdió el acceso al estudio quedaba sin
 *   nadie que la pudiera escuchar hasta vencer.
 * - **Tiene que conservar el acceso al estudio:** la grabación sigue siendo de un estudio. Se
 *   comprueba una vez por estudio; la de un estudio al que ya no entra no aparece.
 * - **El acceso se comprueba antes de pedir la lista, no después.** Primero, en qué estudios
 *   hay grabaciones; después, a cuáles entra; recién entonces las grabaciones de esos estudios,
 *   con el tope. Al revés, las de estudios a los que no entra ocupaban el cupo y la lista podía
 *   salir vacía habiendo alguna (hallazgo de revisión del #183).
 * - Sin contenido y sin sujeto: la tabla no guarda de qué sujeto se retiró, a propósito.
 */
export async function GET(): Promise<Response> {
  try {
    const { orgId, userId, access } = await resolveOrgAccessContext()
    const now = new Date()
    const coordinates = coordinatesStudy(access)

    // 1. En qué estudios hay grabaciones: las de la organización para quien coordina, las
    //    propias para el resto.
    const candidateStudyIds = coordinates ? await listUnassignedAudioStudiesOfOrg({ orgId }) : await listUnassignedAudioStudiesByAuthor({ orgId, userId })

    // 2. A cuáles entra. Una comprobación por estudio.
    const studyNames = new Map<string, string>()
    for (const studyId of new Set(candidateStudyIds)) {
      try {
        const studyAccess = await validatePhiStudyAccess(studyId)
        studyNames.set(studyId, studyAccess.study.name)
      } catch (err) {
        // Solo un acceso negado saca al estudio de la lista. Cualquier otro fallo sube:
        // una lista a medias diría «no tenés ninguna» sin saberlo.
        if (!(err instanceof AccessError) || (err.status !== 403 && err.status !== 404)) throw err
      }
    }

    // 3. Las grabaciones de esos estudios. El tope se aplica acá, sobre lo que la persona
    //    puede ver. Los dos filtros (estudio y, para quien no coordina, persona) van en la
    //    consulta y se repiten acá para que no dependa solo de ella.
    const studyIds = [...studyNames.keys()]
    const listed =
      studyIds.length === 0 ? [] : coordinates ? await listUnassignedAudiosOfOrg({ orgId, studyIds }) : await listUnassignedAudiosByAuthor({ orgId, userId, studyIds })
    // Primero lo que esta persona puede ver; después el tope. La consulta pide una de más: si
    // después de filtrar siguen sobrando, hay grabaciones que no se muestran, y se dice. Contar
    // antes de filtrar avisaría «hay más» por una fila que de todos modos no se iba a mostrar.
    const allowed = listed.filter((row) => studyNames.has(row.studyId) && (coordinates || row.createdBy === userId))
    const truncated = allowed.length > UNASSIGNED_AUDIO_LIST_MAX
    const visible = allowed.slice(0, UNASSIGNED_AUDIO_LIST_MAX)

    const audios = visible.map((row) => ({
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
      // `false`: la grabó otra persona y quien mira la ve porque coordina el estudio.
      own: row.createdBy === userId,
    }))
    return Response.json({ audios, truncated })
  } catch (err) {
    return handleApiError(err)
  }
}
