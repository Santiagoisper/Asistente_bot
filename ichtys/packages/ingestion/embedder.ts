import OpenAI from 'openai'
import { EMBEDDING_DIMENSIONS } from '@ichtys/db'
import {
  formatEmbeddingInput,
  getEmbeddingApiKey,
  getEmbeddingBaseUrl,
  getEmbeddingModel,
  OPENAI_EMBEDDING_MODEL,
  resolveEmbeddingProvider,
} from './embedding-config'

/**
 * embedder.ts - batch embedding generation.
 *
 * - Org override: openAiApiKey → OpenAI text-embedding-3-small (1536 dims).
 * - Default: Groq nomic-embed-text-v1_5 si GROQ_API_KEY, si no OpenAI env.
 * - Vectores Groq (768) se rellenan con ceros hasta 1536 (coseno preservado).
 */

export const EMBEDDING_MODEL = getEmbeddingModel()
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64

export type EmbeddingErrorCode =
  | 'embedding_config_missing'
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
  embedding: number[] | string
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
  /** Key OpenAI de la org (Ajustes). Si se pasa, ignora Groq y usa text-embedding-3-small. */
  openAiApiKey?: string
  /** Prefijo Nomic para Groq; por defecto search_document en batch. */
  task?: 'document' | 'query'
}

let defaultClient: EmbeddingClient | null = null

function createOpenAiClient(apiKey: string, baseURL?: string): EmbeddingClient {
  const openai = new OpenAI({
    apiKey,
    baseURL,
    timeout: 20_000,
    maxRetries: 1,
  })
  return {
    createEmbeddings: (input) => openai.embeddings.create(input),
  }
}

function parseEmbeddingVector(raw: number[] | string): number[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'number')) {
        return parsed
      }
    } catch {
      // fall through
    }
  }
  throw new EmbeddingError('embedding_provider_error', 'Embedding provider returned an invalid vector')
}

function padEmbeddingToSchema(embedding: readonly number[]): number[] {
  if (embedding.length === EMBEDDING_DIMENSIONS) return [...embedding]
  if (embedding.length === 768) {
    return [...embedding, ...Array(EMBEDDING_DIMENSIONS - 768).fill(0)]
  }
  throw new EmbeddingError(
    'embedding_dimension_mismatch',
    'Embedding provider returned an unexpected vector dimension',
  )
}

function getDefaultClient(explicitOpenAiKey?: string): EmbeddingClient {
  if (explicitOpenAiKey) {
    return createOpenAiClient(explicitOpenAiKey)
  }

  if (!defaultClient) {
    const apiKey = getEmbeddingApiKey()
    if (!apiKey) {
      const provider = resolveEmbeddingProvider()
      const envVar = provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'
      throw new EmbeddingError('embedding_config_missing', `${envVar} is not configured`)
    }

    defaultClient = createOpenAiClient(apiKey, getEmbeddingBaseUrl())
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

function resolveModel(options: EmbedBatchOptions): string {
  if (options.client) return EMBEDDING_MODEL
  if (options.openAiApiKey) return OPENAI_EMBEDDING_MODEL
  return getEmbeddingModel()
}

function formatBatchInput(
  batch: readonly string[],
  options: EmbedBatchOptions,
): string[] {
  if (options.openAiApiKey || resolveEmbeddingProvider() !== 'groq') {
    return [...batch]
  }
  const task = options.task ?? 'document'
  return batch.map((text) => formatEmbeddingInput(text, task))
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

  const client = options.client ?? getDefaultClient(options.openAiApiKey)
  const batchSize = getBatchSize(options)
  const model = resolveModel(options)
  const results: EmbeddingResult[] = []

  try {
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize)
      const response = await client.createEmbeddings({
        model,
        input: formatBatchInput(batch, options),
      })

      const embeddings = orderedEmbeddings(response.data, batch.length)
      for (let i = 0; i < embeddings.length; i += 1) {
        const raw = embeddings[i]?.embedding
        const text = batch[i] ?? ''
        if (raw === undefined) {
          throw new EmbeddingError('embedding_provider_error', 'Embedding provider omitted a result')
        }

        const normalized = padEmbeddingToSchema(parseEmbeddingVector(raw))
        validateEmbeddingDimensions(normalized)
        results.push({
          embedding: normalized,
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
 * Embedding of one query, used by retrieval.
 */
export async function embedQuery(text: string, options: EmbedBatchOptions = {}): Promise<number[]> {
  const [result] = await embedBatch([text], { ...options, task: options.task ?? 'query' })
  if (!result) {
    throw new EmbeddingError('embedding_provider_error', 'Embedding provider omitted a query result')
  }

  validateEmbeddingDimensions(result.embedding)
  return result.embedding
}
