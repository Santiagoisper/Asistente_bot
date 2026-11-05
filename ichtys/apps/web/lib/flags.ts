/**
 * La cabina se evalúa en el servidor.
 * En preview, development y local se ve siempre.
 * En production solo si ALPHI_CABINA vale exactamente "on".
 * Si es false, /demo responde notFound() y el menú no incluye el enlace.
 */
export function isCabinaEnabled(): boolean {
  return process.env.VERCEL_ENV !== 'production' || process.env.ALPHI_CABINA === 'on'
}
