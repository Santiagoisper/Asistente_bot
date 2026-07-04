import { handleApiError, validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec, isMeaningfulSpec, specRichness, studySpecSchema } from '@ichtys/ingestion'
import {
  getProtocolDocumentVersionId,
  reextractStudySpec,
} from '@ichtys/ingestion/reextract-spec'

export const runtime = 'nodejs'
export const maxDuration = 300

function formatReextractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/invalid x-api-key|authentication|401|403/i.test(msg)) {
    return 'La clave ANTHROPIC_API_KEY en Vercel parece inválida o faltante. Revisá Environment Variables → Production.'
  }
  if (/usage limits|rate limit|429/i.test(msg)) {
    return `Cuota del proveedor LLM agotada. Configurá GROQ_API_KEY u OPENROUTER_API_KEY (GLM) en .env.local, o esperá a que renueve Anthropic (~1 jul UTC).`
  }
  return msg
}

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

    // Evita spam de versiones si el spec ya es útil (p. ej. clicks repetidos en demo).
    const existing = await getLatestStudySpec({ orgId, studyId })
    if (existing) {
      const parsed = studySpecSchema.safeParse(existing.spec)
      if (parsed.success && isMeaningfulSpec(parsed.data)) {
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
      const result = await reextractStudySpec({ orgId, studyId, documentVersionId })
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
