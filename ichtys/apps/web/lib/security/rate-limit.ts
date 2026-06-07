export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number }

export type RateLimitParams = {
  key: string
  limit: number
  windowSeconds: number
}

export interface RateLimitConfig {
  limit: number
  windowSeconds: number
}

type RedisRestResponse = {
  result?: unknown
  error?: string
}

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local count = redis.call("ZCARD", key)
if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local retry = math.ceil(window / 1000)
  if oldest[2] then
    retry = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
  end
  return {0, retry}
end
local seq = redis.call("INCR", key .. ":seq")
redis.call("ZADD", key, now, tostring(now) .. "-" .. tostring(seq))
redis.call("PEXPIRE", key, window)
redis.call("PEXPIRE", key .. ":seq", window)
return {1, 0}
`

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function isRateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED !== 'false'
}

export function getChatRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_CHAT_PER_MINUTE, 30),
    windowSeconds: 60,
  }
}

export function getUploadRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_UPLOAD_PER_MINUTE, 10),
    windowSeconds: 60,
  }
}

export function getHistoryRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_HISTORY_PER_MINUTE, 100),
    windowSeconds: 60,
  }
}

export function getCitationsRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_CITATIONS_PER_MINUTE, 100),
    windowSeconds: 60,
  }
}

export async function enforceSlidingWindowRateLimit(
  params: RateLimitParams,
): Promise<RateLimitResult> {
  if (!isRateLimitEnabled()) return { limited: false }

  const redis = getRedisRestConfig()
  if (!redis) return { limited: false }

  try {
    const now = Date.now()
    const windowMs = params.windowSeconds * 1000
    const response = await fetch(redis.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        'EVAL',
        SLIDING_WINDOW_SCRIPT,
        '1',
        `rl:${params.key}`,
        String(now),
        String(windowMs),
        String(params.limit),
      ]),
    })

    if (!response.ok) {
      logRateLimitFailure('redis_http_error')
      return { limited: false }
    }

    const payload = (await response.json()) as RedisRestResponse
    if (payload.error) {
      logRateLimitFailure('redis_command_error')
      return { limited: false }
    }

    const tuple = parseRedisTuple(payload.result)
    if (!tuple) {
      logRateLimitFailure('redis_invalid_response')
      return { limited: false }
    }

    return tuple.allowed
      ? { limited: false }
      : { limited: true, retryAfterSeconds: tuple.retryAfterSeconds }
  } catch {
    logRateLimitFailure('rate_limit_internal_error')
    return { limited: false }
  }
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'rate_limited', message: 'Too many requests, please try again later.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, retryAfterSeconds)) },
    },
  )
}

export function clientIpRateLimitKey(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',').at(0)?.trim()
  const realIp = req.headers.get('x-real-ip')?.trim()
  const internalClient = req.headers.get('x-internal-client-id')?.trim()
  return internalClient || forwardedFor || realIp || 'anonymous'
}

function getRedisRestConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url, token }
}

function parseRedisTuple(value: unknown): { allowed: boolean; retryAfterSeconds: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const allowed = Number(value[0])
  const retryAfterSeconds = Number(value[1])
  if (!Number.isFinite(allowed) || !Number.isFinite(retryAfterSeconds)) return null
  return { allowed: allowed === 1, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) }
}

function logRateLimitFailure(code: string): void {
  console.error('[rate-limit]', { code })
}
