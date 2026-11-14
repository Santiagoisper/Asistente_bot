import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clinicalRateLimit, clinicalRateLimitConfig, type ClinicalLimitKind } from '../clinical-rate-limit'
import { resetMemoryRateLimitForTests } from '../rate-limit'

/**
 * Límites de pedidos de las rutas clínicas (evoluciones, grabaciones, laboratorio).
 * La regla que las distingue del chat: **un límite no puede dejar a un médico sin poder
 * guardar porque el servicio que cuenta los pedidos se cayó**. Si ese servicio no responde,
 * se cuenta en este proceso y se sigue. Nunca 503.
 */
const who = { orgId: 'org-a', userId: 'user_1' }
const KINDS: ClinicalLimitKind[] = ['evolution_write', 'audio_write', 'audio_listen', 'lab_upload', 'lab_extract']

beforeEach(() => {
  vi.unstubAllEnvs()
  // Sin servicio de conteo: es el caso que estas rutas tienen que aguantar.
  vi.stubEnv('KV_REST_API_URL', '')
  vi.stubEnv('KV_REST_API_TOKEN', '')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubEnv('RATE_LIMIT_ENABLED', '')
  resetMemoryRateLimitForTests()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('clinicalRateLimit — sin el servicio de conteo', () => {
  it.each(KINDS)('%s: deja pasar hasta el tope y después responde 429, nunca 503', async (kind) => {
    const { limit } = clinicalRateLimitConfig(kind)
    for (let i = 0; i < limit; i++) expect(await clinicalRateLimit(kind, who)).toBeNull()
    const blocked = await clinicalRateLimit(kind, who)
    expect(blocked?.status).toBe(429)
  })

  it('en producción tampoco bloquea por falta del servicio: guardar una evolución sigue andando', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(await clinicalRateLimit('evolution_write', who)).toBeNull()
  })

  it('el tope de una persona no frena a otra, ni el de una organización a otra', async () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_PER_MINUTE', '1')
    expect(await clinicalRateLimit('evolution_write', who)).toBeNull()
    expect((await clinicalRateLimit('evolution_write', who))?.status).toBe(429)
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'user_2' })).toBeNull()
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-b', userId: 'user_1' })).toBeNull()
  })

  it('cada tipo de pedido lleva su cuenta: escuchar no gasta el cupo de guardar', async () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_PER_MINUTE', '1')
    expect(await clinicalRateLimit('evolution_write', who)).toBeNull()
    expect(await clinicalRateLimit('audio_listen', who)).toBeNull()
    expect(await clinicalRateLimit('audio_write', who)).toBeNull()
  })
})

describe('clinicalRateLimit — sin el servicio de conteo, el tope del centro igual se cuenta', () => {
  // Subir un informe de laboratorio llama a un modelo: es la única ruta clínica que gasta. Con
  // el contador caído no se bloquea a nadie por la caída, pero el gasto del centro queda acotado.
  it('121 subidas de laboratorio del mismo centro en un minuto: la 121 responde 429', async () => {
    for (let i = 0; i < 120; i++) {
      expect(await clinicalRateLimit('lab_upload', { orgId: 'org-a', userId: `user_${i}` })).toBeNull()
    }
    expect((await clinicalRateLimit('lab_upload', { orgId: 'org-a', userId: 'user_120' }))?.status).toBe(429)
    expect(await clinicalRateLimit('lab_upload', { orgId: 'org-b', userId: 'user_120' })).toBeNull()
  })

  it('vale para todas las rutas clínicas con tope de centro, no solo para la que gasta', async () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_ORG_PER_MINUTE', '2')
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u1' })).toBeNull()
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u2' })).toBeNull()
    expect((await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u3' }))?.status).toBe(429)
  })

  it('un pedido frenado por el tope del centro no gasta el cupo de la persona', async () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_ORG_PER_MINUTE', '1')
    vi.stubEnv('RATE_LIMIT_EVOLUTION_PER_MINUTE', '1')
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u1' })).toBeNull()
    expect((await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u2' }))?.status).toBe(429)
    // u2 no llegó a contarse: si el centro vuelve a tener lugar, su cupo de uno sigue entero.
    vi.stubEnv('RATE_LIMIT_EVOLUTION_ORG_PER_MINUTE', '5')
    expect(await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u2' })).toBeNull()
    expect((await clinicalRateLimit('evolution_write', { orgId: 'org-a', userId: 'u2' }))?.status).toBe(429)
  })
})

describe('clinicalRateLimit — la respuesta', () => {
  it('dice en castellano qué pasó y cuánto esperar, y que no se guardó nada', async () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_PER_MINUTE', '1')
    await clinicalRateLimit('evolution_write', who)
    const blocked = (await clinicalRateLimit('evolution_write', who))!
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    const body = (await blocked.json()) as { error: string; message: string; retryAfterSeconds: number }
    expect(body.error).toBe('rate_limited')
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(body.message).toBe('Demasiados pedidos seguidos. No se guardó nada. Esperá un momento y volvé a intentar.')
  })
  it('en una lectura no dice que no se guardó nada', async () => {
    vi.stubEnv('RATE_LIMIT_DICTATION_LISTEN_PER_MINUTE', '1')
    await clinicalRateLimit('audio_listen', who)
    const body = (await (await clinicalRateLimit('audio_listen', who))!.json()) as { message: string }
    expect(body.message).toBe('Demasiados pedidos seguidos. Esperá un momento y volvé a intentar.')
  })
})

describe('clinicalRateLimitConfig — topes pensados para un centro con más de cien personas', () => {
  it('guardar evoluciones: 120 personas guardando en el mismo minuto no llegan al tope del centro', () => {
    const config = clinicalRateLimitConfig('evolution_write')
    expect(config).toEqual({ limit: 20, orgLimit: 300, windowSeconds: 60 })
  })

  it('grabaciones: una evolución lleva hasta cinco tomas', () => {
    expect(clinicalRateLimitConfig('audio_write')).toEqual({ limit: 20, orgLimit: 600, windowSeconds: 60 })
  })

  it('escuchar es lectura: tope por persona, sin tope del centro', () => {
    expect(clinicalRateLimitConfig('audio_listen')).toEqual({ limit: 60, windowSeconds: 60 })
  })

  it('laboratorio: cargar informes y extraer valores', () => {
    expect(clinicalRateLimitConfig('lab_upload')).toEqual({ limit: 10, orgLimit: 120, windowSeconds: 60 })
    expect(clinicalRateLimitConfig('lab_extract')).toEqual({ limit: 10, orgLimit: 120, windowSeconds: 60 })
  })

  it('cada tope se puede cambiar por variable, y un valor inválido deja el de fábrica', () => {
    vi.stubEnv('RATE_LIMIT_EVOLUTION_PER_MINUTE', '7')
    vi.stubEnv('RATE_LIMIT_EVOLUTION_ORG_PER_MINUTE', 'muchos')
    expect(clinicalRateLimitConfig('evolution_write')).toEqual({ limit: 7, orgLimit: 300, windowSeconds: 60 })
  })
})
