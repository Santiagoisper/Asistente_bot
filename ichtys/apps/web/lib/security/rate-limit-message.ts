/**
 * Lo que se le dice a quien quiso guardar y chocó con el límite de pedidos (429). Sin
 * dependencias de servidor: lo usa la pantalla.
 */
const MAX_REASONABLE_WAIT_SECONDS = 600

export function rateLimitedSaveMessage(retryAfterSeconds: unknown): string {
  const base = 'Se hicieron demasiados pedidos seguidos. Esta evolución no se guardó, pero lo escrito sigue acá.'
  const usable = typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= MAX_REASONABLE_WAIT_SECONDS
  if (!usable) return `${base} Esperá un momento y tocá «Guardar evolución» otra vez.`
  const seconds = Math.ceil(retryAfterSeconds)
  return `${base} Esperá ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'} y tocá «Guardar evolución» otra vez.`
}

/**
 * Lo mismo para cualquier cambio que no es una evolución (ajustes, equipo, modo): qué no se
 * guardó y cuánto esperar. `null` si la respuesta no es un 429 del limitador.
 */
export function rateLimitedText(body: unknown): string | null {
  if (!body || typeof body !== 'object' || (body as { error?: unknown }).error !== 'rate_limited') return null
  const retry = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds
  const usable = typeof retry === 'number' && Number.isFinite(retry) && retry > 0 && retry <= MAX_REASONABLE_WAIT_SECONDS
  const base = 'Se hicieron demasiados pedidos seguidos. El cambio no se guardó.'
  if (!usable) return `${base} Esperá un momento y probá otra vez.`
  const seconds = Math.ceil(retry as number)
  return `${base} Esperá ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'} y probá otra vez.`
}
