import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ichtys/db', () => ({
  EMBEDDING_DIMENSIONS: 1536,
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
