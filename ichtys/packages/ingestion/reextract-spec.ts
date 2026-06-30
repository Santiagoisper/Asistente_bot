import { and, asc, eq } from 'drizzle-orm'
import { db, documents, pages } from '@ichtys/db'
import { getOrgRagConfig } from '@ichtys/db'
import type { ParsedPage } from './parser'
import { extractStudySpec } from './spec-extractor'
import { getApprovedSpecExamples, saveStudySpec } from './spec-store'
import { studySpecSchema, type StudySpec } from './study-spec'

/** Puntuación simple para comparar specs (criterios + endpoints + visitas). */
export function specRichness(spec: StudySpec): number {
  return (
    spec.inclusionCriteria.length +
    spec.exclusionCriteria.length +
    spec.endpoints.length +
    spec.visits.length
  )
}

export function isMeaningfulSpec(spec: StudySpec): boolean {
  return specRichness(spec) > 0
}

/**
 * Re-extrae el study spec desde páginas ya persistidas (sin re-parsear el PDF).
 * Útil cuando la ingestion indexó bien pero la extracción LLM quedó parcial.
 */
export async function reextractStudySpec(params: {
  orgId: string
  studyId: string
  documentVersionId: string
}): Promise<{ specId: string; version: number; richness: number; warnings: string[] }> {
  const pageRows = await db.query.pages.findMany({
    where: and(
      eq(pages.documentVersionId, params.documentVersionId),
      eq(pages.organizationId, params.orgId),
      eq(pages.studyId, params.studyId),
    ),
    orderBy: [asc(pages.pageNumber)],
  })

  if (pageRows.length === 0) {
    throw new Error('No hay páginas persistidas para este documento')
  }

  const parsedPages: ParsedPage[] = pageRows.map((p) => ({
    pageNumber: p.pageNumber,
    rawText: p.rawText ?? '',
  }))

  const fewShotExamples = await getApprovedSpecExamples({
    orgId: params.orgId,
    limit: 3,
  }).catch(() => [])

  const orgRag = await getOrgRagConfig(params.orgId)

  const { spec, warnings, extractionModel } = await extractStudySpec(
    parsedPages,
    fewShotExamples,
    { llmProviderPreference: orgRag.llmProvider },
  )

  const validated = studySpecSchema.parse(spec)

  if (!isMeaningfulSpec(validated)) {
    const detail = warnings.length > 0 ? warnings.join('; ') : 'localizador sin secciones'
    throw new Error(
      `La extracción no produjo criterios, endpoints ni visitas. ${detail}`,
    )
  }

  const { id, version } = await saveStudySpec({
    orgId: params.orgId,
    studyId: params.studyId,
    documentVersionId: params.documentVersionId,
    spec: validated,
    extractionModel,
  })

  return {
    specId: id,
    version,
    richness: specRichness(validated),
    warnings,
  }
}

/** Resuelve el document_version del protocolo principal del estudio. */
export async function getProtocolDocumentVersionId(params: {
  orgId: string
  studyId: string
}): Promise<string | null> {
  const doc = await db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, params.orgId),
      eq(documents.studyId, params.studyId),
      eq(documents.documentType, 'protocol'),
    ),
    with: {
      versions: {
        orderBy: (v, { desc }) => [desc(v.createdAt)],
        limit: 1,
      },
    },
  })

  return doc?.versions[0]?.id ?? null
}
