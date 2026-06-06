import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  auditLogs,
  chunks,
  db,
  documents,
  documentVersions,
  type Chunk,
  type Document,
  type DocumentVersion,
} from '@ichtys/db'
import { embedBatch, EmbeddingError, type EmbeddingErrorCode } from './embedder'

export const indexDocumentVersionInput = z.object({
  userId: z.string().min(1),
  orgId: z.string().uuid(),
  studyId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
})

export type IndexDocumentVersionInput = z.infer<typeof indexDocumentVersionInput>

export type EmbeddingIndexingErrorCode = EmbeddingErrorCode | 'embedding_internal_error'

export class EmbeddingIndexingError extends Error {
  constructor(
    readonly code: EmbeddingIndexingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EmbeddingIndexingError'
  }
}

interface LoadedDocumentVersion {
  document: Document
  documentVersion: DocumentVersion
}

export interface IndexDocumentVersionResult {
  documentId: string
  documentVersionId: string
  chunkCount: number
  embeddedChunkCount: number
}

async function loadAuthorizedDocumentVersion(
  input: IndexDocumentVersionInput,
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
    throw new EmbeddingIndexingError(
      'embedding_internal_error',
      'Document version is outside the authorized embedding context',
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
    throw new EmbeddingIndexingError(
      'embedding_internal_error',
      'Document is outside the authorized embedding context',
    )
  }

  return { document, documentVersion }
}

async function loadUnembeddedChunks(input: IndexDocumentVersionInput): Promise<Chunk[]> {
  return db.query.chunks.findMany({
    where: and(
      eq(chunks.documentId, input.documentId),
      eq(chunks.documentVersionId, input.documentVersionId),
      eq(chunks.organizationId, input.orgId),
      eq(chunks.studyId, input.studyId),
      isNull(chunks.embedding),
    ),
  })
}

async function auditEmbeddingStarted(
  input: IndexDocumentVersionInput,
  chunkCount: number,
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: input.orgId,
    studyId: input.studyId,
    userId: input.userId,
    action: 'embeddings.started',
    resourceType: 'document_version',
    resourceId: input.documentVersionId,
    metadata: { documentId: input.documentId, chunkCount },
  })
}

async function auditEmbeddingCompleted(
  input: IndexDocumentVersionInput,
  chunkCount: number,
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: input.orgId,
    studyId: input.studyId,
    userId: input.userId,
    action: 'embeddings.completed',
    resourceType: 'document_version',
    resourceId: input.documentVersionId,
    metadata: { documentId: input.documentId, embeddedChunkCount: chunkCount },
  })
}

async function auditEmbeddingFailed(
  input: IndexDocumentVersionInput,
  errorMessage: EmbeddingIndexingErrorCode,
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: input.orgId,
    studyId: input.studyId,
    userId: input.userId,
    action: 'embeddings.failed',
    resourceType: 'document_version',
    resourceId: input.documentVersionId,
    metadata: { documentId: input.documentId, errorMessage },
  })
}

function sanitizeIndexingError(err: unknown): EmbeddingIndexingError {
  if (err instanceof EmbeddingIndexingError) return err
  if (err instanceof EmbeddingError) {
    return new EmbeddingIndexingError(err.code, 'Embedding generation failed')
  }

  return new EmbeddingIndexingError('embedding_internal_error', 'Embedding indexing failed')
}

async function persistEmbeddings(input: IndexDocumentVersionInput, chunkRows: readonly Chunk[]): Promise<number> {
  if (chunkRows.length === 0) return 0

  const embeddings = await embedBatch(chunkRows.map((chunk) => chunk.content))

  await db.transaction(async (tx) => {
    for (let i = 0; i < chunkRows.length; i += 1) {
      const chunk = chunkRows[i]
      const embedding = embeddings[i]
      if (!chunk || !embedding) {
        throw new EmbeddingIndexingError(
          'embedding_internal_error',
          'Embedding result count did not match chunk count',
        )
      }

      await tx
        .update(chunks)
        .set({ embedding: embedding.embedding, tokenCount: embedding.tokenCount })
        .where(
          and(
            eq(chunks.id, chunk.id),
            eq(chunks.documentId, input.documentId),
            eq(chunks.documentVersionId, input.documentVersionId),
            eq(chunks.organizationId, input.orgId),
            eq(chunks.studyId, input.studyId),
          ),
        )
    }
  })

  return embeddings.length
}

export async function indexDocumentVersionChunks(
  input: IndexDocumentVersionInput,
): Promise<IndexDocumentVersionResult> {
  const parsedInput = indexDocumentVersionInput.parse(input)
  await loadAuthorizedDocumentVersion(parsedInput)

  const chunkRows = await loadUnembeddedChunks(parsedInput)
  await auditEmbeddingStarted(parsedInput, chunkRows.length)

  try {
    const embeddedChunkCount = await persistEmbeddings(parsedInput, chunkRows)
    await auditEmbeddingCompleted(parsedInput, embeddedChunkCount)

    return {
      documentId: parsedInput.documentId,
      documentVersionId: parsedInput.documentVersionId,
      chunkCount: chunkRows.length,
      embeddedChunkCount,
    }
  } catch (err) {
    const sanitized = sanitizeIndexingError(err)
    await auditEmbeddingFailed(parsedInput, sanitized.code)
    throw sanitized
  }
}
