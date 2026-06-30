/**
 * Configuración del proveedor de embeddings (Groq u OpenAI).
 *
 * Groq: nomic-embed-text-v1_5 vía API OpenAI-compatible (768 dims).
 * OpenAI: text-embedding-3-small (1536 dims).
 *
 * Vectores más chicos se rellenan con ceros hasta EMBEDDING_DIMENSIONS del
 * schema — la similitud coseno se conserva con padding simétrico.
 */

export type EmbeddingProvider = 'groq' | 'openai'

export const GROQ_EMBEDDING_BASE_URL = 'https://api.groq.com/openai/v1'
export const GROQ_EMBEDDING_MODEL = 'nomic-embed-text-v1_5'
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'

export function resolveEmbeddingProvider(): EmbeddingProvider {
  const explicit = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase()
  if (explicit === 'groq' || explicit === 'openai') return explicit
  if (process.env.GROQ_API_KEY?.trim()) return 'groq'
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai'
  return 'groq'
}

export function getEmbeddingModel(): string {
  const configured = process.env.EMBEDDING_MODEL?.trim()
  if (configured) return configured
  return resolveEmbeddingProvider() === 'groq' ? GROQ_EMBEDDING_MODEL : OPENAI_EMBEDDING_MODEL
}

export function getEmbeddingApiKey(): string | null {
  const provider = resolveEmbeddingProvider()
  if (provider === 'groq') return process.env.GROQ_API_KEY?.trim() || null
  return process.env.OPENAI_API_KEY?.trim() || null
}

export function getEmbeddingBaseUrl(): string | undefined {
  const configured = process.env.EMBEDDING_BASE_URL?.trim()
  if (configured) return configured
  return resolveEmbeddingProvider() === 'groq' ? GROQ_EMBEDDING_BASE_URL : undefined
}

/** Nomic en Groq requiere prefijos de tarea para retrieval. */
export function formatEmbeddingInput(text: string, task: 'document' | 'query'): string {
  if (resolveEmbeddingProvider() !== 'groq') return text
  return task === 'query' ? `search_query: ${text}` : `search_document: ${text}`
}
