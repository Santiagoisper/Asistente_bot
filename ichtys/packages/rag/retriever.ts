import { and, eq, sql } from 'drizzle-orm'
import { db, chunks, type Chunk } from '@ichtys/db'
import { embedQuery } from '@ichtys/ingestion/embedder'

/**
 * retriever.ts — similarity search sobre pgvector.
 *
 * REGLA CRÍTICA (CLAUDE.md 3, ARCHITECTURE.md): el filtro por organization_id +
 * study_id se aplica en el WHERE, ANTES del ordenamiento por distancia. Nunca
 * se hace vector search sin ambos boundaries.
 */

export const DEFAULT_TOP_K = 8
/** Umbral de similaridad coseno mínima (>= 0.75 => distancia coseno <= 0.25). */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.75

export interface RetrieveParams {
  organizationId: string
  studyId: string
  query: string
  topK?: number
  similarityThreshold?: number
}

export interface RetrievedChunk {
  chunk: Chunk
  similarity: number
}

/**
 * Recupera los chunks más relevantes para una query dentro de un único study.
 */
export async function retrieve(params: RetrieveParams): Promise<RetrievedChunk[]> {
  const {
    organizationId,
    studyId,
    query,
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = params

  const queryEmbedding = await embedQuery(query)
  const vectorLiteral = `[${queryEmbedding.join(',')}]`

  // distancia coseno: embedding <=> query ; similaridad = 1 - distancia.
  const similarity = sql<number>`1 - (${chunks.embedding} <=> ${vectorLiteral}::vector)`

  const rows = await db
    .select({ chunk: chunks, similarity })
    .from(chunks)
    .where(
      and(
        eq(chunks.organizationId, organizationId), // ← boundary obligatorio
        eq(chunks.studyId, studyId), // ← boundary obligatorio
      ),
    )
    .orderBy(sql`${chunks.embedding} <=> ${vectorLiteral}::vector`)
    .limit(topK)

  return rows
    .filter((r) => r.similarity >= similarityThreshold)
    .map((r) => ({ chunk: r.chunk, similarity: r.similarity }))
}
