import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ichtys/db', () => ({
  EMBEDDING_DIMENSIONS: 1536,
}))

vi.mock('../embedding-config', () => ({
  resolveEmbeddingProvider: () => 'openai',
  getEmbeddingModel: () => 'text-embedding-3-small',
  getEmbeddingApiKey: () => 'test-key',
  getEmbeddingBaseUrl: () => undefined,
  formatEmbeddingInput: (text: string) => text,
  GROQ_EMBEDDING_MODEL: 'nomic-embed-text-v1_5',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
}))

import {
  EMBEDDING_MODEL,
  EmbeddingError,
  type EmbeddingClient,
  embedBatch,
} from '../embedder'

class RateLimitError extends Error {
  readonly status = 429
}

function createEmbedding(value: number): number[] {
  return Array.from({ length: 1536 }, () => value)
}

function createClient(): {
  client: EmbeddingClient
  calls: { model: string; input: string[] }[]
} {
  const calls: { model: string; input: string[] }[] = []

  return {
    calls,
    client: {
      createEmbeddings: async (input) => {
        calls.push(input)
        return {
          data: input.input.map((_, index) => ({
            embedding: createEmbedding(index + calls.length),
            index,
          })),
        }
      },
    },
  }
}

describe('embedBatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Sin esperas reales en los reintentos por rate limit.
    vi.stubEnv('EMBEDDING_RETRY_BASE_MS', '0')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('retries 429s and succeeds when the provider recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let attempts = 0
    const client: EmbeddingClient = {
      createEmbeddings: async (input) => {
        attempts += 1
        if (attempts <= 2) throw new RateLimitError('rate limited')
        return { data: input.input.map((_, index) => ({ embedding: createEmbedding(1), index })) }
      },
    }

    const results = await embedBatch(['texto sintetico'], { client })

    expect(attempts).toBe(3)
    expect(results).toHaveLength(1)
  })

  it('gives up with embedding_rate_limited when the 429 persists', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let attempts = 0
    const client: EmbeddingClient = {
      createEmbeddings: async () => {
        attempts += 1
        throw new RateLimitError('rate limited')
      },
    }

    await expect(embedBatch(['texto sintetico'], { client })).rejects.toMatchObject({
      code: 'embedding_rate_limited',
    })
    expect(attempts).toBe(9)
  })

  it('does not log the provider message (could echo document text)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client: EmbeddingClient = {
      createEmbeddings: async () => {
        throw new RateLimitError('echo: paciente con datos privados')
      },
    }

    await expect(embedBatch(['x'], { client })).rejects.toBeInstanceOf(EmbeddingError)

    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('paciente')
  })

  it('generates embeddings with the configured 1536 dimensions', async () => {
    const { client, calls } = createClient()

    const results = await embedBatch(['eligibility criteria'], { client })

    expect(calls).toEqual([{ model: EMBEDDING_MODEL, input: ['eligibility criteria'] }])
    expect(results).toHaveLength(1)
    expect(results[0]?.embedding).toHaveLength(1536)
    expect(results[0]?.tokenCount).toBeGreaterThan(0)
  })

  it('handles empty and large batches without provider calls beyond chunked requests', async () => {
    const { client, calls } = createClient()

    await expect(embedBatch([], { client })).resolves.toEqual([])

    const texts = Array.from({ length: 5 }, (_, index) => `chunk ${index}`)
    const results = await embedBatch(texts, { client, batchSize: 2 })

    expect(results).toHaveLength(5)
    expect(calls.map((call) => call.input)).toEqual([
      ['chunk 0', 'chunk 1'],
      ['chunk 2', 'chunk 3'],
      ['chunk 4'],
    ])
  })

  it('sanitizes provider errors and does not log sensitive text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sensitiveText = 'patient has private clinical details'
    const client: EmbeddingClient = {
      createEmbeddings: async () => {
        throw new Error(`provider failed for ${sensitiveText}`)
      },
    }

    await expect(embedBatch([sensitiveText], { client })).rejects.toMatchObject({
      code: 'embedding_provider_error',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('pads smaller provider vectors to the configured schema dimensions', async () => {
    const client768: EmbeddingClient = {
      createEmbeddings: async (input) => ({
        data: input.input.map((_, index) => ({
          embedding: createEmbedding(index + 1).slice(0, 768),
          index,
        })),
      }),
    }

    const results = await embedBatch(['short vector'], { client: client768 })

    expect(results[0]?.embedding).toHaveLength(1536)
    expect(results[0]?.embedding.slice(768)).toEqual(Array(768).fill(0))
  })

  it('maps rate limits and dimension mismatches to controlled error codes', async () => {
    const rateLimitedClient: EmbeddingClient = {
      createEmbeddings: async () => {
        throw new RateLimitError('rate limited')
      },
    }
    const badDimensionClient: EmbeddingClient = {
      createEmbeddings: async () => ({
        data: [{ embedding: [0.1], index: 0 }],
      }),
    }

    await expect(embedBatch(['rate limited'], { client: rateLimitedClient })).rejects.toMatchObject({
      code: 'embedding_rate_limited',
    })

    await expect(embedBatch(['bad dimension'], { client: badDimensionClient })).rejects.toBeInstanceOf(
      EmbeddingError,
    )
    await expect(embedBatch(['bad dimension'], { client: badDimensionClient })).rejects.toMatchObject({
      code: 'embedding_dimension_mismatch',
    })
  })
})
