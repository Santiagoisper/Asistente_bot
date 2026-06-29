import { after } from 'next/server'
import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import {
  getProtocolDocumentVersionId,
  reextractStudySpec,
} from '@ichtys/ingestion/reextract-spec'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/studies/[id]/spec/reextract — re-extrae el spec desde páginas ya
 * persistidas (sin re-indexar chunks). Útil cuando la ingestion quedó "ready"
 * pero el spec salió vacío o parcial.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studyId } = await params

  try {
    const { orgId } = await validateStudyAccess(studyId)

    const documentVersionId = await getProtocolDocumentVersionId({ orgId, studyId })
    if (!documentVersionId) {
      return Response.json({ error: 'No hay protocolo cargado en este estudio.' }, { status: 404 })
    }

    // Respuesta inmediata; extracción en background (varios minutos en protocolos largos).
    after(async () => {
      try {
        const result = await reextractStudySpec({ orgId, studyId, documentVersionId })
        console.log(
          `[spec/reextract] study=${studyId} v${result.version} richness=${result.richness} warnings=${result.warnings.length}`,
        )
      } catch (err) {
        console.error(`[spec/reextract] failed study=${studyId}:`, err)
      }
    })

    return Response.json(
      {
        status: 'processing',
        studyId,
        documentVersionId,
        message: 'Re-extracción de spec iniciada. Actualizá la página en unos minutos.',
      },
      { status: 202 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
