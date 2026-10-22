import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db, documents, documentVersions, pages } from '@ichtys/db'
import { getOrgLlmApiKeys } from '@ichtys/db'
import type { ParsedPage } from './parser'
import { extractStudySpec, SPEC_EXTRACTION_LLM_PROVIDER } from './spec-extractor'
import { getApprovedSpecExamples, getLatestMeaningfulStudySpec, saveStudySpec } from './spec-store'
import { mergeSoaVisits, studySpecSchema, type StudySpec } from './study-spec'

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
  userId?: string | null
}): Promise<{ specId: string; version: number; richness: number; warnings: string[] }> {
  const sourceDocument = await db
    .select({ documentType: documents.documentType })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(
      eq(documentVersions.id, params.documentVersionId),
      eq(documentVersions.organizationId, params.orgId),
      eq(documentVersions.studyId, params.studyId),
      eq(documents.organizationId, params.orgId),
      eq(documents.studyId, params.studyId),
    ))
    .limit(1)
  const visitsOnly = sourceDocument[0]?.documentType === 'soa'

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
    {
      llmProviderPreference: SPEC_EXTRACTION_LLM_PROVIDER,
      llmApiKeys: orgLlmKeys,
      orgId: params.orgId,
      studyId: params.studyId,
      userId: params.userId,
      visitsOnly,
    },
  )

  const validated = studySpecSchema.parse(spec)

  if (visitsOnly ? validated.visits.length === 0 : !isMeaningfulSpec(validated)) {
    throw new Error(
      visitsOnly
        ? 'La extracción de la guía SoA no produjo visitas utilizables.'
        : 'La extracción no produjo criterios, endpoints ni visitas.',
    )
  }

  const previousMeaningful = visitsOnly
    ? await getLatestMeaningfulStudySpec({ orgId: params.orgId, studyId: params.studyId })
    : null
  const previousSpec = previousMeaningful
    ? studySpecSchema.parse(previousMeaningful.spec)
    : null
  const specToSave = visitsOnly
    ? { ...mergeSoaVisits(previousSpec, validated.visits, params.documentVersionId), extractionWarnings: warnings }
    : { ...validated, extractionWarnings: warnings }

  const { id, version } = await saveStudySpec({
    orgId: params.orgId,
    studyId: params.studyId,
    documentVersionId: visitsOnly ? previousMeaningful?.documentVersionId ?? params.documentVersionId : params.documentVersionId,
    spec: specToSave,
    extractionModel,
  })

  return {
    specId: id,
    version,
    richness: specRichness(specToSave),
    warnings,
  }
}

/** Resuelve el document_version del protocolo principal del estudio. */
export async function getProtocolDocumentVersionId(params: {
  orgId: string
  studyId: string
}): Promise<string | null> {
  const latest = await db
    .select({ documentVersionId: documentVersions.id })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(and(
      eq(documents.organizationId, params.orgId),
      eq(documents.studyId, params.studyId),
      inArray(documents.documentType, ['protocol', 'soa']),
      eq(documentVersions.organizationId, params.orgId),
      eq(documentVersions.studyId, params.studyId),
    ))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1)

  return latest[0]?.documentVersionId ?? null
}
