import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clientIpRateLimitKey,
  enforceSlidingWindowRateLimit,
  getChatRateLimitConfig,
  getCitationsRateLimitConfig,
  getHistoryRateLimitConfig,
  getUploadRateLimitConfig,
  isRateLimitEnabled,
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
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: false })
  })

  it('returns limited with retryAfterSeconds when Redis denies', async () => {
    mockFetch({ result: [0, 17] })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 17 })
  })

  it('fails open on provider errors without exposing raw error details', async () => {
    mockFetch({ error: 'connection string and token should not be logged' })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: false })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', {
      code: 'redis_command_error',
    })
  })

  it('builds 429 responses with JSON body and Retry-After', async () => {
    const response = rateLimitResponse(9)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
    const body = await response.json() as { error: string; message: string }
    expect(body).toEqual({ error: 'rate_limited', message: 'Too many requests, please try again later.' })
  })

  it('uses minimum 1 second for Retry-After', async () => {
    const response = rateLimitResponse(0)
    expect(response.headers.get('Retry-After')).toBe('1')
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

  describe('RATE_LIMIT_ENABLED', () => {
    it('is enabled by default', () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', '')
      expect(isRateLimitEnabled()).toBe(true)
    })

    it('is disabled when set to "false"', () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
      expect(isRateLimitEnabled()).toBe(false)
    })

    it('bypasses rate limiting when RATE_LIMIT_ENABLED=false regardless of Redis', async () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
      mockFetch({ result: [0, 30] }) // Redis would deny, but should be bypassed

      await expect(
        enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
      ).resolves.toEqual({ limited: false })
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('configurable limits', () => {
    it('getChatRateLimitConfig returns default 30 when env var not set', () => {
      vi.stubEnv('RATE_LIMIT_CHAT_PER_MINUTE', '')
      expect(getChatRateLimitConfig()).toEqual({ limit: 30, windowSeconds: 60 })
    })

    it('getChatRateLimitConfig reads env var', () => {
      vi.stubEnv('RATE_LIMIT_CHAT_PER_MINUTE', '50')
      expect(getChatRateLimitConfig()).toEqual({ limit: 50, windowSeconds: 60 })
    })

    it('getUploadRateLimitConfig returns default 10', () => {
      vi.stubEnv('RATE_LIMIT_UPLOAD_PER_MINUTE', '')
      expect(getUploadRateLimitConfig()).toEqual({ limit: 10, windowSeconds: 60 })
    })

    it('getUploadRateLimitConfig reads env var', () => {
      vi.stubEnv('RATE_LIMIT_UPLOAD_PER_MINUTE', '5')
      expect(getUploadRateLimitConfig()).toEqual({ limit: 5, windowSeconds: 60 })
    })

    it('getHistoryRateLimitConfig returns default 100', () => {
      vi.stubEnv('RATE_LIMIT_HISTORY_PER_MINUTE', '')
      expect(getHistoryRateLimitConfig()).toEqual({ limit: 100, windowSeconds: 60 })
    })

    it('getCitationsRateLimitConfig returns default 100', () => {
      vi.stubEnv('RATE_LIMIT_CITATIONS_PER_MINUTE', '')
      expect(getCitationsRateLimitConfig()).toEqual({ limit: 100, windowSeconds: 60 })
    })

    it('ignores non-positive integer env var values and uses defaults', () => {
      vi.stubEnv('RATE_LIMIT_CHAT_PER_MINUTE', 'not-a-number')
      expect(getChatRateLimitConfig().limit).toBe(30)
      vi.stubEnv('RATE_LIMIT_CHAT_PER_MINUTE', '0')
      expect(getChatRateLimitConfig().limit).toBe(30)
      vi.stubEnv('RATE_LIMIT_CHAT_PER_MINUTE', '-5')
      expect(getChatRateLimitConfig().limit).toBe(30)
    })
  })
})
