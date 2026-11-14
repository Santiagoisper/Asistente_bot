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

/**
 * Fecha de baja de la ruta de sellado (C3, docs/compliance/REGULATORY-BASELINE.md). Es un
 * trabajo que se hace una vez por organización: pasada esta fecha la ruta no responde en
 * ningún entorno y se borra del código.
 */
export const SCREENING_SEAL_CLOSES_AT = '2027-01-01T00:00:00.000Z'

/**
 * La ruta que sella las evaluaciones de elegibilidad anteriores al cifrado.
 * Fuera de producción está abierta. En producción solo si ALPHI_SEAL_SCREENING vale
 * exactamente "on": encenderla es una decisión expresa. Pasada la fecha de baja, cerrada siempre.
 */
export function isScreeningSealEnabled(now: Date = new Date()): boolean {
  if (now.getTime() >= Date.parse(SCREENING_SEAL_CLOSES_AT)) return false
  return process.env.VERCEL_ENV !== 'production' || process.env.ALPHI_SEAL_SCREENING === 'on'
}
