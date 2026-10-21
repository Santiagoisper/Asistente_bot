import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ichtys/db', () => ({
  EMBEDDING_DIMENSIONS: 1536,
}))

vi.mock('../embedding-config', () => ({
  resolveEmbeddingProvider: () => 'google',
  getEmbeddingModel: () => 'gemini-embedding-001',
  getEmbeddingApiKey: () => 'clave-sintetica',
  getEmbeddingBaseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai/',
  formatEmbeddingInput: (text: string) => text,
  GROQ_EMBEDDING_MODEL: 'nomic-embed-text-v1_5',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
}))

const createMock = vi.fn()
const constructorMock = vi.fn()

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    embeddings = { create: (...args: unknown[]) => createMock(...args) }
    constructor(options: unknown) {
      constructorMock(options)
    }
  },
}))

import { embedBatch } from '../embedder'

beforeEach(() => {
  createMock.mockReset()
  constructorMock.mockReset()
})

describe('embedBatch con proveedor Google', () => {
  it('pide 1536 dimensiones en formato float al endpoint de Google', async () => {
    createMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
    })

    const [result] = await embedBatch(['texto sintetico'])

    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'clave-sintetica',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }),
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-embedding-001',
        dimensions: 1536,
        encoding_format: 'float',
      }),
    )
    expect(result?.embedding).toHaveLength(1536)
  })
})
