export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number; reason?: 'quota' | 'unavailable' }

export type RateLimitParams = {
  key: string
  limit: number
  windowSeconds: number
  /**
   * `deny` (default): si falta Redis o falla, la operación se bloquea.
   * `allow`: solo lecturas. Sin Redis, el request sigue.
   * `memory`: ráfaga dentro de este proceso. No reemplaza el cupo compartido.
   */
  onRedisUnavailable?: 'deny' | 'allow' | 'memory'
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
  // En producción el cupo no se apaga con una variable. Solo test y desarrollo
  // pueden desactivarlo, y tienen que hacerlo explícito.
  if (process.env.NODE_ENV === 'production') return true
  return process.env.RATE_LIMIT_ENABLED !== 'false'
}

/**
 * Aviso único cuando una lectura explícita sigue sin cupo. Las operaciones que
 * gastan no usan este camino: si Redis no responde, se bloquean.
 */
const disabledWarnings = new Set<string>()

function warnRateLimitDisabledOnce(reason: string): void {
  if (disabledWarnings.has(reason)) return
  disabledWarnings.add(reason)
  console.warn(`[rate-limit] DESHABILITADO (${reason}) — los requests NO se están limitando`)
}

/** Solo para tests: permite volver a observar el warning dentro del mismo proceso. */
export function resetRateLimitWarningsForTests(): void {
  disabledWarnings.clear()
}

const memoryHits = new Map<string, number[]>()

/** Solo para tests: aísla la cuota en memoria entre casos. */
export function resetMemoryRateLimitForTests(): void {
  memoryHits.clear()
}

function enforceMemoryQuota(params: RateLimitParams): RateLimitResult {
  const now = Date.now()
  const windowMs = params.windowSeconds * 1000
  const hits = (memoryHits.get(params.key) ?? []).filter((ts) => now - ts < windowMs)
  if (hits.length >= params.limit) {
    const oldest = hits[0] ?? now
    memoryHits.set(params.key, hits)
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    }
  }
  hits.push(now)
  memoryHits.set(params.key, hits)
  return { limited: false }
}

function denyUnavailable(): RateLimitResult {
  return { limited: true, retryAfterSeconds: 60, reason: 'unavailable' }
}

function whenRedisUnavailable(params: RateLimitParams, failureCode: string): RateLimitResult {
  if (params.onRedisUnavailable === 'memory') {
    if (failureCode !== 'redis_unconfigured') logRateLimitFailure(failureCode)
    return enforceMemoryQuota(params)
  }
  if (params.onRedisUnavailable === 'allow') {
    if (failureCode === 'redis_unconfigured') {
      warnRateLimitDisabledOnce('falta config Redis REST (UPSTASH_REDIS_REST_URL/TOKEN)')
    } else {
      logRateLimitFailure(failureCode)
    }
    return { limited: false }
  }
  logRateLimitFailure(failureCode)
  return denyUnavailable()
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

/**
 * Ingestión: cada corrida descarga, parsea y extrae el spec con Opus (~60-120 s).
 * El cliente puede repetir el POST sobre el mismo documentoVersionId.
 */
export function getIngestionRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_INGESTION_PER_MINUTE, 5),
    windowSeconds: 60,
  }
}

/**
 * Re-extracción de spec: cada corrida es una llamada a Claude Opus sobre hasta
 * 150 páginas (hasta 300 s). Tope bajo por usuario+estudio para que el gasto de
 * la clave de plataforma no sea ilimitado.
 */
export function getSpecReextractRateLimitConfig(): RateLimitConfig {
  return {
    limit: parsePositiveInt(process.env.RATE_LIMIT_SPEC_REEXTRACT_PER_MINUTE, 3),
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
  if (!isRateLimitEnabled()) {
    warnRateLimitDisabledOnce('RATE_LIMIT_ENABLED=false')
    return { limited: false }
  }

  const redis = getRedisRestConfig()
  if (!redis) {
    return whenRedisUnavailable(params, 'redis_unconfigured')
  }

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
      return whenRedisUnavailable(params, 'redis_http_error')
    }

    const payload = (await response.json()) as RedisRestResponse
    if (payload.error) {
      return whenRedisUnavailable(params, 'redis_command_error')
    }

    const tuple = parseRedisTuple(payload.result)
    if (!tuple) {
      return whenRedisUnavailable(params, 'redis_invalid_response')
    }

    return tuple.allowed
      ? { limited: false }
      : { limited: true, retryAfterSeconds: tuple.retryAfterSeconds }
  } catch {
    return whenRedisUnavailable(params, 'rate_limit_internal_error')
  }
}

export function rateLimitUnavailableResponse(): Response {
  return Response.json(
    {
      error: 'rate_limit_unavailable',
      message: 'No se pudo verificar el cupo. Probá de nuevo en unos minutos.',
    },
    { status: 503, headers: { 'Retry-After': '60' } },
  )
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
