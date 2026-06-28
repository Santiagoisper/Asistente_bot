import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  auditLogs,
  chunks,
  db,
  documents,
  documentVersions,
  pages,
  type Document,
  type DocumentVersion,
} from '@ichtys/db'
import { chunkPages } from './chunker'
import { EmbeddingIndexingError, indexDocumentVersionChunks } from './indexer'
import { parsePdf, PdfParseError } from './parser'
import { extractStudySpec } from './spec-extractor'
import { getApprovedSpecExamples, saveStudySpec } from './spec-store'

/**
 * pipeline.ts - ingestion orchestrator.
 *
 * The HTTP layer validates Clerk auth and object access. This internal pipeline
 * receives a safe context so a future worker can run without depending on
 * request-local auth().
 */

export const runIngestionInput = z.object({
  userId: z.string().min(1),
  orgId: z.string().uuid(),
  studyId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
})

export type RunIngestionInput = z.infer<typeof runIngestionInput>

export type IngestionStatus = 'processing' | 'ready' | 'error'

export interface IngestionResult {
  documentId: string
  documentVersionId: string
  pageCount: number
  chunkCount: number
  embeddedChunkCount: number
  status: IngestionStatus
  errorMessage?: IngestionErrorCode
}

export type IngestionErrorCode =
  | 'blob_download_failed'
  | 'embedding_dimension_mismatch'
  | 'embedding_internal_error'
  | 'embedding_provider_error'
  | 'embedding_rate_limited'
  | 'pdf_text_extraction_failed'
  | 'pdf_contains_no_extractable_text'
  | 'ingestion_internal_error'

class IngestionPipelineError extends Error {
  constructor(
    readonly code: IngestionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'IngestionPipelineError'
  }
}

interface LoadedDocumentVersion {
  document: Document
  documentVersion: DocumentVersion
}

async function loadAuthorizedDocumentVersion(
  input: RunIngestionInput,
): Promise<LoadedDocumentVersion> {
  const documentVersion = await db.query.documentVersions.findFirst({
    where: and(
      eq(documentVersions.id, input.documentVersionId),
      eq(documentVersions.documentId, input.documentId),
      eq(documentVersions.organizationId, input.orgId),
      eq(documentVersions.studyId, input.studyId),
    ),
  })

  if (!documentVersion) {
    throw new IngestionPipelineError(
      'ingestion_internal_error',
      'Document version is outside the authorized ingestion context',
    )
  }

  const document = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, input.documentId),
      eq(documents.organizationId, input.orgId),
      eq(documents.studyId, input.studyId),
    ),
  })

  if (!document) {
    throw new IngestionPipelineError(
      'ingestion_internal_error',
      'Document is outside the authorized ingestion context',
    )
  }

  return { document, documentVersion }
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunksRead: Uint8Array[] = []
  let totalLength = 0
  let done = false

  try {
    while (!done) {
      const result = await reader.read()
      done = result.done
      if (!result.done) {
        chunksRead.push(result.value)
        totalLength += result.value.byteLength
      }
    }
  } finally {
    reader.releaseLock()
  }

  const buffer = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunksRead) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return buffer
}

async function downloadBlob(blobUrl: string): Promise<Uint8Array> {
  // Dev mock: blobUrl is file:// pointing to local filesystem.
  if (blobUrl.startsWith('file://')) {
    try {
      const { readFile } = await import('node:fs/promises')
      const localPath = blobUrl.replace('file://', '')
      console.log(`[DEV-MOCK Blob] Reading from local path: ${localPath}`)
      return await readFile(localPath)
    } catch (err) {
      console.warn('[DEV-MOCK Blob] Local read failed:', err)
      throw new IngestionPipelineError('blob_download_failed', 'Dev blob not found on local filesystem')
    }
  }

  const response = await fetch(blobUrl)
  if (!response.ok || !response.body) {
    throw new IngestionPipelineError('blob_download_failed', `Failed to fetch blob: ${response.status}`)
  }

  return readStream(response.body)
}

function sanitizeIngestionError(err: unknown): IngestionErrorCode {
  if (err instanceof IngestionPipelineError) return err.code
  if (err instanceof EmbeddingIndexingError) return err.code
  if (err instanceof PdfParseError) return err.code
  return 'ingestion_internal_error'
}

async function markProcessing(input: RunIngestionInput): Promise<void> {
  await db
    .update(documentVersions)
    .set({ status: 'processing', errorMessage: null })
    .where(
      and(
        eq(documentVersions.id, input.documentVersionId),
        eq(documentVersions.organizationId, input.orgId),
        eq(documentVersions.studyId, input.studyId),
      ),
    )

  await db.insert(auditLogs).values({
    organizationId: input.orgId,
    studyId: input.studyId,
    userId: input.userId,
    action: 'ingestion.started',
    resourceType: 'document_version',
    resourceId: input.documentVersionId,
    metadata: { documentId: input.documentId },
  })
}

async function markError(input: RunIngestionInput, errorMessage: IngestionErrorCode): Promise<void> {
  await db
    .update(documentVersions)
    .set({ status: 'error', errorMessage })
    .where(
      and(
        eq(documentVersions.id, input.documentVersionId),
        eq(documentVersions.organizationId, input.orgId),
        eq(documentVersions.studyId, input.studyId),
      ),
    )

  await db.insert(auditLogs).values({
    organizationId: input.orgId,
    studyId: input.studyId,
    userId: input.userId,
    action: 'ingestion.failed',
    resourceType: 'document_version',
    resourceId: input.documentVersionId,
    metadata: { documentId: input.documentId, errorMessage },
  })
}

/**
 * Runs ingestion for one document version.
 */
export async function runIngestion(input: RunIngestionInput): Promise<IngestionResult> {
  const parsedInput = runIngestionInput.parse(input)
  const { document, documentVersion } = await loadAuthorizedDocumentVersion(parsedInput)

  await markProcessing(parsedInput)

  try {
    const pdfData = await downloadBlob(documentVersion.blobUrl)
    const parsedDocument = await parsePdf(pdfData)
    const contentChunks = chunkPages(parsedDocument.pages)

    if (contentChunks.length === 0) {
      throw new IngestionPipelineError(
        'pdf_contains_no_extractable_text',
        'PDF produced no ingestible chunks',
      )
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(chunks)
        .where(
          and(
            eq(chunks.documentVersionId, parsedInput.documentVersionId),
            eq(chunks.organizationId, parsedInput.orgId),
            eq(chunks.studyId, parsedInput.studyId),
          ),
        )

      await tx
        .delete(pages)
        .where(
          and(
            eq(pages.documentVersionId, parsedInput.documentVersionId),
            eq(pages.organizationId, parsedInput.orgId),
            eq(pages.studyId, parsedInput.studyId),
          ),
        )

      await tx.insert(pages).values(
        parsedDocument.pages.map((page) => ({
          documentVersionId: parsedInput.documentVersionId,
          organizationId: parsedInput.orgId,
          studyId: parsedInput.studyId,
          pageNumber: page.pageNumber,
          rawText: page.rawText,
        })),
      )

      await tx.insert(chunks).values(
        contentChunks.map((chunk) => ({
          documentId: parsedInput.documentId,
          documentVersionId: parsedInput.documentVersionId,
          organizationId: parsedInput.orgId,
          studyId: parsedInput.studyId,
          documentType: document.documentType,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          sectionTitle: chunk.sectionTitle,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        })),
      )
    })

    const indexingResult = await indexDocumentVersionChunks(parsedInput)

    // Extraer study spec si el documento es un protocolo.
    // AWAITED: fire-and-forget no funciona en Lambda (el runtime se congela
    // cuando se envía la respuesta HTTP, matando los calls a Claude pendientes).
    if (document.documentType === 'protocol') {
      try {
        const fewShotExamples = await getApprovedSpecExamples({
          orgId: parsedInput.orgId,
          limit: 3,
        }).catch(err => {
          console.warn('[spec-extractor] Could not load few-shot examples:', err)
          return []
        })

        const { spec, warnings, extractionModel, detectedLanguage } =
          await extractStudySpec(parsedDocument.pages, fewShotExamples)

        if (warnings.length > 0) {
          console.warn(`[spec-extractor] warnings for documentVersionId=${parsedInput.documentVersionId}:`, warnings)
        }
        if (detectedLanguage) {
          console.log(`[spec-extractor] detected language: ${detectedLanguage}`)
        }

        const { id, version } = await saveStudySpec({
          orgId: parsedInput.orgId,
          studyId: parsedInput.studyId,
          documentVersionId: parsedInput.documentVersionId,
          spec,
          extractionModel,
        })
        console.log(`[spec-extractor] saved draft spec id=${id} version=${version}`)
      } catch (err) {
        // El fallo del spec no falla la ingestion — el documento queda 'ready'
        // pero sin spec. El usuario puede reprocesar o el sistema lo detectará.
        console.error(`[spec-extractor] FAILED for documentVersionId=${parsedInput.documentVersionId}:`, err)
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          status: 'ready',
          pageCount: parsedDocument.pageCount,
          errorMessage: null,
        })
        .where(
          and(
            eq(documentVersions.id, parsedInput.documentVersionId),
            eq(documentVersions.organizationId, parsedInput.orgId),
            eq(documentVersions.studyId, parsedInput.studyId),
          ),
        )

      await tx.insert(auditLogs).values({
        organizationId: parsedInput.orgId,
        studyId: parsedInput.studyId,
        userId: parsedInput.userId,
        action: 'ingestion.completed',
        resourceType: 'document_version',
        resourceId: parsedInput.documentVersionId,
        metadata: {
          documentId: parsedInput.documentId,
          pageCount: parsedDocument.pageCount,
          chunkCount: contentChunks.length,
          embeddedChunkCount: indexingResult.embeddedChunkCount,
        },
      })
    })

    return {
      documentId: parsedInput.documentId,
      documentVersionId: parsedInput.documentVersionId,
      pageCount: parsedDocument.pageCount,
      chunkCount: contentChunks.length,
      embeddedChunkCount: indexingResult.embeddedChunkCount,
      status: 'ready',
    }
  } catch (err) {
    const errorMessage = sanitizeIngestionError(err)
    console.error(`[ingestion] FAILED documentVersionId=${parsedInput.documentVersionId} errorCode=${errorMessage}`, err)
    await markError(parsedInput, errorMessage)

    return {
      documentId: parsedInput.documentId,
      documentVersionId: parsedInput.documentVersionId,
      pageCount: 0,
      chunkCount: 0,
      embeddedChunkCount: 0,
      status: 'error',
      errorMessage,
    }
  }
}

export { parsePdf } from './parser'
export { chunkPages } from './chunker'
export { embedBatch, embedQuery } from './embedder'
export { indexDocumentVersionChunks } from './indexer'
export { extractStudySpec } from './spec-extractor'
export { saveStudySpec, getLatestStudySpec } from './spec-store'
export { studySpecSchema } from './study-spec'
export type { StudySpec, EligibilityCriterion, StudyEndpoint, StudyVisit } from './study-spec'
