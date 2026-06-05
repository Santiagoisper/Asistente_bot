import { EMBEDDING_DIMENSIONS } from '@ichtys/db'

/**
 * embedder.ts — generación de embeddings en batch.
 *
 * Modelo: text-embedding-3-small (OpenAI), 1536 dims (alineado con
 * EMBEDDING_DIMENSIONS en el schema de chunks). Si cambia el modelo, actualizar
 * el schema y regenerar embeddings.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small'

export interface EmbeddingResult {
  embedding: number[]
  tokenCount: number
}

/**
 * Embeddings en batch para una lista de textos.
 * Mantiene el orden de entrada == orden de salida.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  // TODO(paso-5): llamada batch a OpenAI; validar dim === EMBEDDING_DIMENSIONS.
  void texts
  throw new Error('embedBatch not implemented (paso 5)')
}

/**
 * Embedding de una única query (usado por el retriever en RAG).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [result] = await embedBatch([text])
  if (!result || result.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Embedding dimension mismatch')
  }
  return result.embedding
}
