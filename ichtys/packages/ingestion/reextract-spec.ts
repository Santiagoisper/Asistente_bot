import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db, documents, documentVersions, pages } from '@ichtys/db'
import { getOrgLlmApiKeys } from '@ichtys/db'
import type { ParsedPage } from './parser'
import { extractStudySpec, SPEC_EXTRACTION_LLM_PROVIDER } from './spec-extractor'
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

  const orgLlmKeys = await getOrgLlmApiKeys(params.orgId)

  const { spec, warnings, extractionModel } = await extractStudySpec(
    parsedPages,
    fewShotExamples,
    { llmProviderPreference: SPEC_EXTRACTION_LLM_PROVIDER, llmApiKeys: orgLlmKeys },
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

/** Resuelve la versión más reciente de protocolo o SoA del estudio. */
export async function getProtocolDocumentVersionId(params: {
  orgId: string
  studyId: string
}): Promise<string | null> {
  const [latestVersion] = await db
    .select({ id: documentVersions.id })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.organizationId, params.orgId),
        eq(documents.studyId, params.studyId),
        inArray(documents.documentType, ['protocol', 'soa']),
      ),
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(1)

  return latestVersion?.id ?? null
}
