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
