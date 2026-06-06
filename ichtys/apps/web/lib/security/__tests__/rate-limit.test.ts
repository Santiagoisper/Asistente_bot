import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clientIpRateLimitKey,
  enforceSlidingWindowRateLimit,
  rateLimitResponse,
} from '../rate-limit'

const ORIGINAL_FETCH = globalThis.fetch

function mockFetch(result: unknown, ok = true): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(result), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as typeof fetch
}

describe('rate limit helper', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('allows requests when Redis is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 20, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: false })
  })

  it('returns limited with retryAfterSeconds when Redis denies', async () => {
    mockFetch({ result: [0, 17] })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 20, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 17 })
  })

  it('fails open on provider errors without exposing raw error details', async () => {
    mockFetch({ error: 'connection string and token should not be logged' })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 20, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: false })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', {
      code: 'redis_command_error',
    })
  })

  it('builds 429 responses with Retry-After', async () => {
    const response = rateLimitResponse(9)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
    await expect(response.text()).resolves.toBe('Too Many Requests')
  })

  it('uses internal header or IP headers for answer-test rate limit key', () => {
    const internal = new Request('http://localhost', {
      headers: { 'x-internal-client-id': 'runner-1', 'x-forwarded-for': '203.0.113.1' },
    })
    const forwarded = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })

    expect(clientIpRateLimitKey(internal)).toBe('runner-1')
    expect(clientIpRateLimitKey(forwarded)).toBe('203.0.113.9')
  })
})
