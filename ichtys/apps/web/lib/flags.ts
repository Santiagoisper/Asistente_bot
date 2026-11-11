/**
 * La cabina se evalúa en el servidor.
 * En preview, development y local se ve siempre.
 * En production solo si ALPHI_CABINA vale exactamente "on".
 * Si es false, /demo responde notFound() y el menú no incluye el enlace.
 */
export function isCabinaEnabled(): boolean {
  return process.env.VERCEL_ENV !== 'production' || process.env.ALPHI_CABINA === 'on'
}

/**
 * Cáscara del Clinical Research OS (menú lateral + Inicio).
 * Misma regla que la cabina: en preview, development y local se ve siempre;
 * en production solo si ALPHI_OS vale exactamente "on". Apagado, la app
 * conserva el layout y el dashboard anteriores.
 */
export function isOsEnabled(): boolean {
  return process.env.VERCEL_ENV !== 'production' || process.env.ALPHI_OS === 'on'
}
