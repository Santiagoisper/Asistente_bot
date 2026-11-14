/**
 * Límites de pedidos de las rutas clínicas: evoluciones, grabaciones y laboratorio.
 * Usa el mismo conteo que el chat y las cargas (`rate-limit.ts`), con una diferencia a propósito:
 *
 * **Un límite no puede dejar a alguien sin poder guardar una evolución porque el servicio que
 * cuenta los pedidos no responde.** El chat se bloquea en ese caso (gasta plata); acá no. Si
 * el servicio no está, se cuenta dentro de este proceso y el pedido sigue. Estas rutas nunca
 * responden 503 por el límite.
 *
 * Los topes están pensados para un centro con más de cien personas trabajando a la vez: el de
 * cada persona frena a un equipo que repite pedidos por error; el del centro, a muchos a la vez.
 */
import { getOrCreateRequestId, log, makeRecord } from '../observability/logger'
import { enforceSlidingWindowRateLimit, type RateLimitConfig } from './rate-limit'

export type ClinicalLimitKind = 'evolution_write' | 'audio_write' | 'audio_listen' | 'lab_upload' | 'lab_extract'

interface KindSpec {
  env: string
  limit: number
  /** Ausente en lecturas. */
  orgLimit?: number
  /** `true` si el pedido guarda algo: cambia lo que se le dice a la persona. */
  writes: boolean
}

const KINDS: Record<ClinicalLimitKind, KindSpec> = {
  // 120 personas guardando en el mismo minuto no llegan al tope del centro.
  evolution_write: { env: 'EVOLUTION', limit: 20, orgLimit: 300, writes: true },
  // Una evolución lleva hasta cinco tomas (D22).
  audio_write: { env: 'DICTATION_AUDIO', limit: 20, orgLimit: 600, writes: true },
  audio_listen: { env: 'DICTATION_LISTEN', limit: 60, writes: false },
  lab_upload: { env: 'LAB_UPLOAD', limit: 10, orgLimit: 120, writes: true },
  lab_extract: { env: 'LAB_EXTRACT', limit: 10, orgLimit: 120, writes: true },
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Tope por persona y por centro, por minuto. Cada uno se cambia con `RATE_LIMIT_<TIPO>[_ORG]_PER_MINUTE`. */
export function clinicalRateLimitConfig(kind: ClinicalLimitKind): RateLimitConfig {
  const spec = KINDS[kind]
  return {
    limit: positiveInt(process.env[`RATE_LIMIT_${spec.env}_PER_MINUTE`], spec.limit),
    ...(spec.orgLimit !== undefined
      ? { orgLimit: positiveInt(process.env[`RATE_LIMIT_${spec.env}_ORG_PER_MINUTE`], spec.orgLimit) }
      : {}),
    windowSeconds: 60,
  }
}

export interface ClinicalLimitContext {
  orgId: string
  userId: string
  studyId?: string
  /** Para el registro técnico. Sin contenido: ruta y método. */
  req?: Request
  endpoint?: string
}

/**
 * `null` si el pedido puede seguir; si no, la respuesta 429 para devolver tal cual. Se llama
 * después de comprobar el acceso (hace falta saber quién es) y antes de leer el cuerpo.
 */
export async function clinicalRateLimit(kind: ClinicalLimitKind, context: ClinicalLimitContext): Promise<Response | null> {
  const config = clinicalRateLimitConfig(kind)
  const result = await enforceSlidingWindowRateLimit({
    key: `${kind}:${context.orgId}:${context.userId}`,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    ...(config.orgLimit !== undefined ? { orgKey: `${kind}-org:${context.orgId}`, orgLimit: config.orgLimit } : {}),
    // Nunca `deny`: ver el comentario de arriba.
    onRedisUnavailable: 'memory',
  })
  if (!result.limited) return null

  const retryAfterSeconds = Math.max(1, result.retryAfterSeconds)
  log(
    makeRecord({
      requestId: context.req ? getOrCreateRequestId(context.req) : crypto.randomUUID(),
      level: 'warn',
      event: 'api.rate_limit.blocked',
      endpoint: context.endpoint ?? kind,
      method: context.req?.method ?? 'POST',
      userId: context.userId,
      ...(context.studyId ? { studyId: context.studyId } : {}),
      statusCode: 429,
    }),
  )
  return Response.json(
    {
      error: 'rate_limited',
      retryAfterSeconds,
      message: KINDS[kind].writes
        ? 'Demasiados pedidos seguidos. No se guardó nada. Esperá un momento y volvé a intentar.'
        : 'Demasiados pedidos seguidos. Esperá un momento y volvé a intentar.',
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}
