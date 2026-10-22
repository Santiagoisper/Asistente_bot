import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { getLatestSpecAttempt, isMeaningfulSpec, specRichness, studySpecSchema } from '@ichtys/ingestion'
import {
  getProtocolDocumentVersionId,
  reextractStudySpec,
} from '@ichtys/ingestion/reextract-spec'

export const runtime = 'nodejs'
export const maxDuration = 300

function formatReextractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/invalid x-api-key|authentication|401|403/i.test(msg)) {
    return 'El servicio de IA rechazó la credencial de la plataforma. Avisale al administrador.'
  }
  if (/usage limits|rate limit|429|quota/i.test(msg)) {
    return 'El servicio de IA está saturado o sin cupo en este momento. Probá de nuevo en unos minutos.'
  }
  return msg
}

/**
 * POST /api/studies/[id]/spec/reextract — re-extrae el spec desde páginas ya
 * persistidas (sin re-indexar chunks). Útil cuando la ingestion quedó "ready"
 * pero el spec salió vacío o parcial.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studyId } = await params
  const force = new URL(req.url).searchParams.get('force') === '1'

  try {
    const { orgId, userId } = await validateStudyAccess(studyId)

    const documentVersionId = await getProtocolDocumentVersionId({ orgId, studyId })
    if (!documentVersionId) {
      return Response.json({ error: 'No hay protocolo cargado en este estudio.' }, { status: 404 })
    }

    // Evita spam de versiones si el spec ya es útil (p. ej. clicks repetidos en demo).
    // Un spec con grupos fallidos (warnings) o sin visitas NO cuenta como listo: el usuario debe poder reintentar.
    const existing = force ? null : await getLatestSpecAttempt({ orgId, studyId })
    if (existing) {
      const parsed = studySpecSchema.safeParse(existing.spec)
      if (
        parsed.success &&
        !parsed.data.extractionFailed &&
        (parsed.data.extractionWarnings ?? []).length === 0 &&
        parsed.data.visits.length > 0 &&
        isMeaningfulSpec(parsed.data)
      ) {
        const richness = specRichness(parsed.data)
        const ageMs = Date.now() - existing.createdAt.getTime()
        if (richness >= 10 && ageMs < 15 * 60 * 1000) {
          return Response.json({
            status: 'already_ready',
            studyId,
            version: existing.version,
            richness,
            message: `Spec v${existing.version} ya tiene ${richness} ítems (${parsed.data.inclusionCriteria.length} incl, ${parsed.data.exclusionCriteria.length} excl). Refrescando vista…`,
          })
        }
      }
    }

    try {
      const result = await reextractStudySpec({ orgId, studyId, documentVersionId, userId })
      console.log(
        `[spec/reextract] study=${studyId} v${result.version} richness=${result.richness} warnings=${result.warnings.length}`,
      )
      return Response.json({
        status: 'completed',
        studyId,
        documentVersionId,
        version: result.version,
        richness: result.richness,
        warnings: result.warnings,
        message: `Spec v${result.version} guardado (${result.richness} ítems). Actualizá la página para verlo.`,
      })
    } catch (err) {
      console.error(`[spec/reextract] failed study=${studyId}:`, err)
      return Response.json(
        { error: formatReextractError(err) },
        { status: 422 },
      )
    }
  } catch (err) {
    return handleApiError(err)
  }
}
