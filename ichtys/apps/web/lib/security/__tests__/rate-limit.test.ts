import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clientIpRateLimitKey,
  enforceSlidingWindowRateLimit,
  getChatRateLimitConfig,
  getCitationsRateLimitConfig,
  getHistoryRateLimitConfig,
  getIngestionRateLimitConfig,
  getSpecReextractRateLimitConfig,
  getUploadRateLimitConfig,
  isRateLimitEnabled,
  rateLimitResponse,
  resetRateLimitWarningsForTests,
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

  it('cierra la cuota en memoria cuando falta Redis en una operación cara', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('RATE_LIMIT_ENABLED', '')
    const params = {
      key: 'spec-reextract:user-ficticio:study-ficticio',
      limit: 2,
      windowSeconds: 60,
      onRedisUnavailable: 'memory' as const,
    }

    await expect(enforceSlidingWindowRateLimit(params)).resolves.toEqual({ limited: false })
    await expect(enforceSlidingWindowRateLimit(params)).resolves.toEqual({ limited: false })
    const denied = await enforceSlidingWindowRateLimit(params)
    expect(denied.limited).toBe(true)
  })

  it('usa la cuota en memoria si Redis falla en una operación cara', async () => {
    mockFetch({ error: 'redis down' })
    const params = {
      key: 'ingestion:user-ficticio:doc-ficticio',
      limit: 1,
      windowSeconds: 60,
      onRedisUnavailable: 'memory' as const,
    }

    await expect(enforceSlidingWindowRateLimit(params)).resolves.toEqual({ limited: false })
    const denied = await enforceSlidingWindowRateLimit(params)
    expect(denied.limited).toBe(true)
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', { code: 'redis_command_error' })
  })

  it('bloquea cuando Redis no está configurado', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', { code: 'redis_unconfigured' })
  })

  it('returns limited with retryAfterSeconds when Redis denies', async () => {
    mockFetch({ result: [0, 17] })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 17 })
  })

  it('bloquea si Redis responde error, sin el detalle crudo', async () => {
    const sentinel = 'connection string and token should not be logged'
    mockFetch({ error: sentinel })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'chat:user:study', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', {
      code: 'redis_command_error',
    })
    expect(JSON.stringify(console.error.mock?.calls ?? [])).not.toContain(sentinel)
  })

  it('bloquea si Redis responde HTTP de error', async () => {
    mockFetch({ error: 'upstream' }, false)

    await expect(
      enforceSlidingWindowRateLimit({ key: 'upload:user:org', limit: 10, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', { code: 'redis_http_error' })
  })

  it('bloquea si Redis devuelve una tupla inválida', async () => {
    mockFetch({ result: 'no-es-tupla' })

    await expect(
      enforceSlidingWindowRateLimit({ key: 'bulk:user:org', limit: 10, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', { code: 'redis_invalid_response' })
  })

  it('bloquea si la llamada a Redis lanza', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('sk-ant-provider-raw-ficticio-NO-LOG')
    }) as typeof fetch

    await expect(
      enforceSlidingWindowRateLimit({ key: 'stream:user:org', limit: 30, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith('[rate-limit]', { code: 'rate_limit_internal_error' })
    expect(JSON.stringify(console.error.mock?.calls ?? [])).not.toContain('sk-ant-provider-raw-ficticio-NO-LOG')
  })

  it('en producción ignora RATE_LIMIT_ENABLED=false y bloquea sin Redis', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')

    await expect(
      enforceSlidingWindowRateLimit({ key: 'reextract:org:user', limit: 3, windowSeconds: 60 }),
    ).resolves.toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
    expect(globalThis.fetch).toBe(ORIGINAL_FETCH)
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

    it('no cuenta en memoria cuando RATE_LIMIT_ENABLED=false', async () => {
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
      const params = {
        key: 'spec-reextract:dev-local',
        limit: 1,
        windowSeconds: 60,
        onRedisUnavailable: 'memory' as const,
      }

      await expect(enforceSlidingWindowRateLimit(params)).resolves.toEqual({ limited: false })
      await expect(enforceSlidingWindowRateLimit(params)).resolves.toEqual({ limited: false })
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

  describe('warning de fail-open (una vez por cold start)', () => {
    it('no anuncia fail-open cuando falta Redis: bloquea', async () => {
      resetRateLimitWarningsForTests()
      vi.stubEnv('RATE_LIMIT_ENABLED', '')
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
      vi.stubEnv('KV_REST_API_URL', '')
      vi.stubEnv('KV_REST_API_TOKEN', '')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const first = await enforceSlidingWindowRateLimit({ key: 'a', limit: 1, windowSeconds: 60 })
      await enforceSlidingWindowRateLimit({ key: 'b', limit: 1, windowSeconds: 60 })

      expect(first).toEqual({ limited: true, retryAfterSeconds: 60, reason: 'unavailable' })
      const avisos = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('[rate-limit] DESHABILITADO'))
      expect(avisos).toHaveLength(0)
      warn.mockRestore()
    })

    it('avisa una sola vez cuando RATE_LIMIT_ENABLED=false', async () => {
      resetRateLimitWarningsForTests()
      vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      await enforceSlidingWindowRateLimit({ key: 'a', limit: 1, windowSeconds: 60 })
      await enforceSlidingWindowRateLimit({ key: 'b', limit: 1, windowSeconds: 60 })

      const avisos = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('[rate-limit] DESHABILITADO'))
      expect(avisos).toHaveLength(1)
      expect(avisos[0]).toContain('RATE_LIMIT_ENABLED=false')
      warn.mockRestore()
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

    it('getIngestionRateLimitConfig returns default 5', () => {
      vi.stubEnv('RATE_LIMIT_INGESTION_PER_MINUTE', '')
      expect(getIngestionRateLimitConfig()).toEqual({ limit: 5, windowSeconds: 60 })
    })

    it('getIngestionRateLimitConfig reads env var', () => {
      vi.stubEnv('RATE_LIMIT_INGESTION_PER_MINUTE', '2')
      expect(getIngestionRateLimitConfig()).toEqual({ limit: 2, windowSeconds: 60 })
    })

    it('getSpecReextractRateLimitConfig returns default 3', () => {
      vi.stubEnv('RATE_LIMIT_SPEC_REEXTRACT_PER_MINUTE', '')
      expect(getSpecReextractRateLimitConfig()).toEqual({ limit: 3, windowSeconds: 60 })
    })

    it('getSpecReextractRateLimitConfig reads env var', () => {
      vi.stubEnv('RATE_LIMIT_SPEC_REEXTRACT_PER_MINUTE', '1')
      expect(getSpecReextractRateLimitConfig()).toEqual({ limit: 1, windowSeconds: 60 })
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
