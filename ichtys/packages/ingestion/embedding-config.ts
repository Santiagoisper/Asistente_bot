/**
 * Configuración del proveedor de embeddings (Groq u OpenAI).
 *
 * Groq: nomic-embed-text-v1_5 vía API OpenAI-compatible (768 dims).
 * OpenAI: text-embedding-3-small (1536 dims).
 *
 * Vectores más chicos se rellenan con ceros hasta EMBEDDING_DIMENSIONS del
 * schema — la similitud coseno se conserva con padding simétrico.
 */

export type EmbeddingProvider = 'groq' | 'openai' | 'google'

export const GROQ_EMBEDDING_BASE_URL = 'https://api.groq.com/openai/v1'
export const GROQ_EMBEDDING_MODEL = 'nomic-embed-text-v1_5'
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
// Google Gemini vía su endpoint compatible con OpenAI. Soporta pedir 1536 dims
// (= EMBEDDING_DIMENSIONS), así que no necesita padding.
export const GOOGLE_EMBEDDING_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
export const GOOGLE_EMBEDDING_MODEL = 'gemini-embedding-001'

export function resolveEmbeddingProvider(): EmbeddingProvider {
  const explicit = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase()
  if (explicit === 'groq' || explicit === 'openai' || explicit === 'google') return explicit
  // Groq va último: retiró nomic-embed-text-v1_5 (2026); muchos proyectos tienen varias keys.
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai'
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'google'
  if (process.env.GROQ_API_KEY?.trim()) return 'groq'
  return 'openai'
}

export function getEmbeddingModel(): string {
  const configured = process.env.EMBEDDING_MODEL?.trim()
  if (configured) return configured
  switch (resolveEmbeddingProvider()) {
    case 'groq':
      return GROQ_EMBEDDING_MODEL
    case 'google':
      return GOOGLE_EMBEDDING_MODEL
    default:
      return OPENAI_EMBEDDING_MODEL
  }
}

/**
 * Identifica el espacio vectorial en uso. Embeddings de distinto proveedor o modelo
 * NO son comparables entre sí: no se deben mezclar en un mismo documento.
 */
export function getEmbeddingFingerprint(): string {
  return `${resolveEmbeddingProvider()}:${getEmbeddingModel()}:${getEmbeddingBaseUrl() ?? 'default'}`
}

export function getEmbeddingApiKey(): string | null {
  switch (resolveEmbeddingProvider()) {
    case 'groq':
      return process.env.GROQ_API_KEY?.trim() || null
    case 'google':
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || null
    default:
      return process.env.OPENAI_API_KEY?.trim() || null
  }
}

export function getEmbeddingBaseUrl(): string | undefined {
  const configured = process.env.EMBEDDING_BASE_URL?.trim()
  if (configured) return configured
  switch (resolveEmbeddingProvider()) {
    case 'groq':
      return GROQ_EMBEDDING_BASE_URL
    case 'google':
      return GOOGLE_EMBEDDING_BASE_URL
    default:
      return undefined
  }
}

/** Nomic en Groq requiere prefijos de tarea para retrieval. */
export function formatEmbeddingInput(text: string, task: 'document' | 'query'): string {
  if (resolveEmbeddingProvider() !== 'groq') return text
  return task === 'query' ? `search_query: ${text}` : `search_document: ${text}`
}
