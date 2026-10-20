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
  if (/insufficient balance|no resource package|please recharge/i.test(msg)) {
    return 'Z.AI rechazó GLM: la clave activa no tiene un paquete de API general disponible. ALPHI usa primero GLM_API_KEY de plataforma. Confirmá que pertenezca a la cuenta Z.AI con un paquete Usage Bundle o saldo prepago y que use el endpoint general https://api.z.ai/api/paas/v4. El GLM Coding Plan tiene un endpoint exclusivo para tareas de programación y no aplica a la extracción de protocolos.'
  }
  if (/invalid x-api-key|authentication|401|403/i.test(msg)) {
    return 'Z.AI rechazó la clave GLM activa. Revisá GLM_API_KEY en Vercel → Production y confirmá que pertenezca a la cuenta Z.AI correcta.'
  }
  if (/usage limits|rate limit|429/i.test(msg)) {
    return 'GLM agotó la cuota o el límite de solicitudes. Revisá el plan y los límites de GLM_API_KEY en Z.AI.'
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
      return Response.json({ error: 'No hay protocolo ni SoA cargado en este estudio.' }, { status: 404 })
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
