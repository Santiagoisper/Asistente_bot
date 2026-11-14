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
 * trabajo que se hace una vez: pasada esta fecha la ruta no responde en ningún entorno y se
 * borra del código.
 */
export const SCREENING_SEAL_CLOSES_AT = '2027-01-01T00:00:00.000Z'

/**
 * Quiénes pueden sellar las evaluaciones de elegibilidad anteriores al cifrado: los
 * identificadores de usuario de ALPHI_SEAL_OPERATORS, separados por coma. Es una lista de
 * quienes responden por el sistema, no un rol de un centro. Sin la variable no hay nadie, y la
 * ruta no existe: cargarla en un entorno es la decisión expresa de habilitarla ahí. Pasada la
 * fecha de baja no hay nadie, aunque la variable siga cargada.
 */
export function screeningSealOperators(now: Date = new Date()): readonly string[] {
  if (now.getTime() >= Date.parse(SCREENING_SEAL_CLOSES_AT)) return []
  const ids = (process.env.ALPHI_SEAL_OPERATORS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return [...new Set(ids)]
}
