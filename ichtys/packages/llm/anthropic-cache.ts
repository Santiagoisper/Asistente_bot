/**
 * anthropic-cache.ts — prompt caching del system prompt para Anthropic.
 *
 * Por qué existe: `ai` v4 (la versión de este repo) solo acepta `system` como
 * string — no soporta las "partes" con providerOptions que marcan los
 * breakpoints de cache (eso llega con el SDK v5, deuda ya documentada del
 * audit). Mientras tanto, este wrapper del fetch inyecta
 * `cache_control: { type: 'ephemeral' }` en el system block de cada
 * POST /v1/messages: el system es el prefijo estable y repetido de las
 * llamadas del chat (SYSTEM_PROMPT idéntico en cada pregunta).
 *
 * Trade-off documentado: el cache write cuesta ~1.25x el input del system y
 * cada read ~0.10x (precios claude-*-5-5). Break-even ≈ 1 llamada dentro del
 * TTL de 5 min — en una sesión de chat normal gana; en tráfico esporádico se
 * apaga con ANTHROPIC_PROMPT_CACHING=0.
 */

const ANTHROPIC_MESSAGES_URL_RE = /\/v1\/messages\/?$/

/** ANTHROPIC_PROMPT_CACHING=0|false|off desactiva la inyección (default: activada). */
export function isPromptCachingEnabled(): boolean {
  const raw = process.env.ANTHROPIC_PROMPT_CACHING?.toLowerCase().trim()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

type SystemBlock = Record<string, unknown> & { cache_control?: unknown }

function markSystemForCaching(body: Record<string, unknown>): void {
  const system = body.system
  if (typeof system === 'string') {
    body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    return
  }
  if (Array.isArray(system) && system.length > 0) {
    // Marca el ÚLTIMO block sin cache_control (el breakpoint cachea el prefijo
    // hasta ese punto). Nunca pisa una marca existente.
    for (let i = system.length - 1; i >= 0; i--) {
      const block = system[i] as SystemBlock
      if (block && typeof block === 'object' && block.cache_control === undefined) {
        block.cache_control = { type: 'ephemeral' }
        return
      }
    }
  }
}

/**
 * Envuelve el fetch del SDK de Anthropic inyectando el cache_control del
 * system. Best-effort: cualquier cuerpo inesperado pasa intacto — el caching
 * jamás puede romper una llamada.
 */
export function withAnthropicPromptCache(fetchFn: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (!isPromptCachingEnabled()) return fetchFn(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method.toUpperCase() !== 'POST' || !ANTHROPIC_MESSAGES_URL_RE.test(url)) {
      return fetchFn(input, init)
    }
    const rawBody = init?.body
    if (typeof rawBody !== 'string') return fetchFn(input, init)
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>
      if (typeof body.system === 'undefined') return fetchFn(input, init)
      markSystemForCaching(body)
      return fetchFn(input, { ...init, body: JSON.stringify(body) })
    } catch {
      return fetchFn(input, init)
    }
  }
}
