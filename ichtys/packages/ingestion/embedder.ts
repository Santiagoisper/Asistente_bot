import OpenAI from 'openai'
import { EMBEDDING_DIMENSIONS } from '@ichtys/db'

/**
 * embedder.ts - batch embedding generation.
 *
 * Model: text-embedding-3-small (OpenAI), 1536 dimensions. If the model
 * changes, update the chunks schema and re-index stored chunks.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64

export type EmbeddingErrorCode =
  | 'embedding_provider_error'
  | 'embedding_dimension_mismatch'
  | 'embedding_rate_limited'

export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

export interface EmbeddingResult {
  embedding: number[]
  tokenCount: number
}

interface ProviderEmbedding {
  embedding: number[]
  index?: number
}

interface ProviderEmbeddingResponse {
  data: ProviderEmbedding[]
}

export interface EmbeddingClient {
  createEmbeddings(input: { model: string; input: string[] }): Promise<ProviderEmbeddingResponse>
}

export interface EmbedBatchOptions {
  batchSize?: number
  client?: EmbeddingClient
}

let defaultClient: EmbeddingClient | null = null

function getDefaultClient(): EmbeddingClient {
  if (!defaultClient) {
    const openai = new OpenAI({ timeout: 20_000, maxRetries: 1 })
    defaultClient = {
      createEmbeddings: (input) => openai.embeddings.create(input),
    }
  }

  return defaultClient
}

function getBatchSize(options: EmbedBatchOptions): number {
  const envValue = Number.parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '', 10)
  const configured = options.batchSize ?? (Number.isFinite(envValue) ? envValue : DEFAULT_EMBEDDING_BATCH_SIZE)
  return Math.max(1, Math.min(configured, 128))
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function statusFromError(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  if (!('status' in err)) return null

  const status = err.status
  return typeof status === 'number' ? status : null
}

function sanitizeEmbeddingError(err: unknown): EmbeddingError {
  if (err instanceof EmbeddingError) return err
  if (statusFromError(err) === 429) {
    return new EmbeddingError('embedding_rate_limited', 'Embedding provider rate limited the request')
  }

  return new EmbeddingError('embedding_provider_error', 'Embedding provider request failed')
}

function orderedEmbeddings(data: readonly ProviderEmbedding[], expectedLength: number): ProviderEmbedding[] {
  const withIndexes = data.every((item) => typeof item.index === 'number')
  const ordered = withIndexes
    ? [...data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    : [...data]

  if (ordered.length !== expectedLength) {
    throw new EmbeddingError(
      'embedding_provider_error',
      'Embedding provider returned a different number of embeddings than requested',
    )
  }

  return ordered
}

function validateEmbeddingDimensions(embedding: readonly number[]): void {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      'embedding_dimension_mismatch',
      'Embedding provider returned an unexpected vector dimension',
    )
  }
}

/**
 * Generates embeddings for a list of texts.
 * Output order matches input order.
 */
export async function embedBatch(
  texts: readonly string[],
  options: EmbedBatchOptions = {},
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  const client = options.client ?? getDefaultClient()
  const batchSize = getBatchSize(options)
  const results: EmbeddingResult[] = []

  try {
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize)
      const response = await client.createEmbeddings({
        model: EMBEDDING_MODEL,
        input: [...batch],
      })

      const embeddings = orderedEmbeddings(response.data, batch.length)
      for (let i = 0; i < embeddings.length; i += 1) {
        const embedding = embeddings[i]?.embedding
        const text = batch[i] ?? ''
        if (!embedding) {
          throw new EmbeddingError('embedding_provider_error', 'Embedding provider omitted a result')
        }

        validateEmbeddingDimensions(embedding)
        results.push({
          embedding,
          tokenCount: estimateTokens(text),
        })
      }
    }

    return results
  } catch (err) {
    throw sanitizeEmbeddingError(err)
  }
}

/**
 * Embedding of one query, used by future retrieval.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [result] = await embedBatch([text])
  if (!result) {
    throw new EmbeddingError('embedding_provider_error', 'Embedding provider omitted a query result')
  }

  validateEmbeddingDimensions(result.embedding)
  return result.embedding
}
