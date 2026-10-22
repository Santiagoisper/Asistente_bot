import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_EMBEDDING_BASE_URL,
  GOOGLE_EMBEDDING_MODEL,
  getEmbeddingApiKey,
  getEmbeddingBaseUrl,
  getEmbeddingModel,
  resolveEmbeddingProvider,
} from '../embedding-config'

function clearEmbeddingEnv(): void {
  for (const name of [
    'EMBEDDING_PROVIDER',
    'EMBEDDING_MODEL',
    'EMBEDDING_BASE_URL',
    'OPENAI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GROQ_API_KEY',
  ]) {
    vi.stubEnv(name, '')
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('embedding-config: proveedor por defecto', () => {
  it('prefiere OpenAI, luego Google, y Groq queda último', () => {
    clearEmbeddingEnv()
    vi.stubEnv('GROQ_API_KEY', 'g')
    expect(resolveEmbeddingProvider()).toBe('groq')

    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'k')
    expect(resolveEmbeddingProvider()).toBe('google')

    vi.stubEnv('OPENAI_API_KEY', 'o')
    expect(resolveEmbeddingProvider()).toBe('openai')
  })

  it('EMBEDDING_PROVIDER explícito gana sobre las keys disponibles', () => {
    clearEmbeddingEnv()
    vi.stubEnv('OPENAI_API_KEY', 'o')
    vi.stubEnv('EMBEDDING_PROVIDER', 'google')
    expect(resolveEmbeddingProvider()).toBe('google')
  })
})

describe('embedding-config: Google', () => {
  it('usa gemini-embedding-001, el endpoint compatible y GOOGLE_GENERATIVE_AI_API_KEY', () => {
    clearEmbeddingEnv()
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'clave-sintetica')

    expect(resolveEmbeddingProvider()).toBe('google')
    expect(getEmbeddingModel()).toBe(GOOGLE_EMBEDDING_MODEL)
    expect(getEmbeddingBaseUrl()).toBe(GOOGLE_EMBEDDING_BASE_URL)
    expect(getEmbeddingApiKey()).toBe('clave-sintetica')
  })

  it('sin ninguna key no inventa una: devuelve null', () => {
    clearEmbeddingEnv()
    expect(getEmbeddingApiKey()).toBeNull()
  })
})
