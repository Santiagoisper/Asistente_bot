import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  chunks,
  db,
  documentType,
  EMBEDDING_DIMENSIONS,
  type DocumentType,
} from '@ichtys/db'
import { embedQuery, EmbeddingError, type EmbeddingErrorCode } from '@ichtys/ingestion/embedder'

/**
 * retriever.ts - pgvector similarity search over embedded chunks.
 *
 * The tenant filter is part of the SQL WHERE used by the vector query. Never
 * retrieve global top-K and filter org/study in memory.
 */

export const DEFAULT_TOP_K = 12
export const MAX_TOP_K = 20

export type RetrievalErrorCode =
  | EmbeddingErrorCode
  | 'retrieval_invalid_input'
  | 'query_embedding_failed'

export class RetrievalError extends Error {
  constructor(
    readonly code: RetrievalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RetrievalError'
  }
}

export interface RetrieveParams {
  queryText: string
  orgId: string
  studyId: string
  topK?: number
  documentType?: DocumentType
  /** OpenAI key de la org (embeddings). Si no se pasa, usa env del servidor. */
  openAiApiKey?: string
}

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  documentVersionId: string
  documentType: DocumentType
  pageStart: number
  pageEnd: number
  sectionTitle: string | null
  content: string
  similarityScore: number
}

const retrieveParamsSchema = z.object({
  queryText: z.string().trim().min(1),
  orgId: z.string().uuid(),
  studyId: z.string().uuid(),
  topK: z.number().int().positive().max(MAX_TOP_K).default(DEFAULT_TOP_K),
  documentType: z.enum(documentType).optional(),
  openAiApiKey: z.string().min(8).optional(),
})

type ParsedRetrieveParams = z.infer<typeof retrieveParamsSchema>

interface RetrievedChunkRow {
  chunkId: string
  documentId: string
  documentVersionId: string
  documentType: DocumentType
  pageStart: number
  pageEnd: number
  sectionTitle: string | null
  content: string
  similarityScore: number
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`
}

function validateEmbeddingDimensions(embedding: readonly number[]): void {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RetrievalError(
      'embedding_dimension_mismatch',
      'Query embedding has unexpected dimensions',
    )
  }
}

function sanitizeQueryEmbeddingError(err: unknown): RetrievalError {
  if (err instanceof RetrievalError) return err
  if (err instanceof EmbeddingError) {
    return new RetrievalError(err.code, 'Query embedding generation failed')
  }

  return new RetrievalError('query_embedding_failed', 'Query embedding generation failed')
}

function parseParams(params: RetrieveParams): ParsedRetrieveParams {
  const parsed = retrieveParamsSchema.safeParse(params)
  if (!parsed.success) {
    throw new RetrievalError('retrieval_invalid_input', 'Invalid retrieval parameters')
  }

  return parsed.data
}

const EMBED_TIMEOUT_MS = 15_000

export async function embedRetrievalQuery(
  queryText: string,
  openAiApiKey?: string,
): Promise<number[]> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new RetrievalError('query_embedding_failed', 'Embedding timeout')), EMBED_TIMEOUT_MS),
    )
    const embedding = await Promise.race([
      embedQuery(queryText, { openAiApiKey }),
      timeout,
    ])
    validateEmbeddingDimensions(embedding)
    return embedding
  } catch (err) {
    throw sanitizeQueryEmbeddingError(err)
  }
}

/**
 * Retrieves relevant chunks inside one authorized organization/study boundary.
 */
export async function retrieveRelevantChunks(params: RetrieveParams): Promise<RetrievedChunk[]> {
  const parsed = parseParams(params)
  console.log('[retriever] embedding query...')
  const queryEmbedding = await embedRetrievalQuery(parsed.queryText, parsed.openAiApiKey)
  console.log('[retriever] embedding done, running vector search...')
  const vector = vectorLiteral(queryEmbedding)
  const distance = sql<number>`${chunks.embedding} <=> ${vector}::vector`
  const similarityScore = sql<number>`1 - (${distance})`
  const whereClause = parsed.documentType
    ? and(
        eq(chunks.organizationId, parsed.orgId),
        eq(chunks.studyId, parsed.studyId),
        eq(chunks.documentType, parsed.documentType),
        isNotNull(chunks.embedding),
      )
    : and(
        eq(chunks.organizationId, parsed.orgId),
        eq(chunks.studyId, parsed.studyId),
        isNotNull(chunks.embedding),
      )

  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      documentVersionId: chunks.documentVersionId,
      documentType: chunks.documentType,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      sectionTitle: chunks.sectionTitle,
      content: chunks.content,
      similarityScore,
    })
    .from(chunks)
    .where(whereClause)
    .orderBy(distance)
    .limit(parsed.topK)

  return rows.map((row: RetrievedChunkRow) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    documentType: row.documentType,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    sectionTitle: row.sectionTitle,
    content: row.content,
    similarityScore: row.similarityScore,
  }))
}

/**
 * Compatibility wrapper for the future answer engine. New code should call
 * retrieveRelevantChunks().
 */
export async function retrieve(params: {
  organizationId: string
  studyId: string
  query: string
  topK?: number
}): Promise<RetrievedChunk[]> {
  return retrieveRelevantChunks({
    queryText: params.query,
    orgId: params.organizationId,
    studyId: params.studyId,
    topK: params.topK,
  })
}
