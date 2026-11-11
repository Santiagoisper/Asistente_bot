import { resolveModuleBaseUrl, SIGNING_KEY_ENV, summaryUrl } from './config'
import { moduleSummarySchema, type ModuleSummary, type OsModule } from './summary-schema'
import { signOsToken } from './token'

export type ModuleStatus =
  | 'ok'
  | 'not_configured'
  | 'unreachable'
  | 'unauthorized'
  | 'invalid_response'

export interface ModuleSummaryResult {
  module: OsModule
  status: ModuleStatus
  summary: ModuleSummary | null
  fetchedAt: string
}

export interface FetchSummaryDeps {
  fetch?: typeof fetch
  env?: Record<string, string | undefined>
  now?: () => Date
  /** Solo para pruebas: el valor de producción es SUMMARY_TIMEOUT_MS. */
  timeoutMs?: number
}

export const SUMMARY_TIMEOUT_MS = 2_500
export const SUMMARY_CACHE_TTL_MS = 60_000
export const SUMMARY_MAX_BYTES = 256 * 1024
const CACHE_MAX_ENTRIES = 500

const cache = new Map<string, { at: number; result: ModuleSummaryResult }>()

export function clearSummaryCache(): void {
  cache.clear()
}

/** Lee el cuerpo hasta el tope; null si lo supera. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > SUMMARY_MAX_BYTES) return null
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > SUMMARY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Pide el resumen de un satélite. Nunca lanza: todo problema se traduce a un
 * estado, para que una tarjeta del Inicio caída no arrastre a las demás.
 * No registra el token ni el cuerpo de la respuesta.
 */
export async function fetchModuleSummary(
  module: OsModule,
  ctx: { userId: string; orgId: string },
  deps: FetchSummaryDeps = {},
): Promise<ModuleSummaryResult> {
  const env = deps.env ?? process.env
  const now = deps.now ?? (() => new Date())
  const doFetch = deps.fetch ?? fetch
  const done = (status: ModuleStatus, summary: ModuleSummary | null = null): ModuleSummaryResult => ({
    module,
    status,
    summary,
    fetchedAt: now().toISOString(),
  })

  const base = resolveModuleBaseUrl(module, env)
  const privateKeyPem = env[SIGNING_KEY_ENV]
  if (!base || !privateKeyPem) return done('not_configured')

  // El satélite puede responder distinto según el rol del usuario: la caché
  // es por usuario, no por organización.
  const cacheKey = `${module}:${ctx.orgId}:${ctx.userId}`
  const cached = cache.get(cacheKey)
  if (cached && now().getTime() - cached.at < SUMMARY_CACHE_TTL_MS) return cached.result

  let token: string
  try {
    token = signOsToken({ module, userId: ctx.userId, orgId: ctx.orgId, privateKeyPem, now: now() })
  } catch {
    return done('not_configured')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SUMMARY_TIMEOUT_MS)
  try {
    const response = await doFetch(summaryUrl(base), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) return done('unauthorized')
    if (!response.ok) return done('unreachable')

    const text = await readCapped(response)
    if (text === null) return done('invalid_response')

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return done('invalid_response')
    }
    const parsed = moduleSummarySchema.safeParse(json)
    if (!parsed.success || parsed.data.module !== module) return done('invalid_response')

    const result = done('ok', parsed.data)
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear()
    cache.set(cacheKey, { at: now().getTime(), result })
    return result
  } catch {
    // Conexión rechazada, DNS, redirección o tiempo agotado.
    return done('unreachable')
  } finally {
    clearTimeout(timer)
  }
}
