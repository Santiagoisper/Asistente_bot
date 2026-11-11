/**
 * Qué se hace con la imagen de un informe de laboratorio después de revisarlo.
 *
 * - `keep` (por defecto): se conserva, cifrada, junto al informe. Quien revisa
 *   más tarde puede volver a ver de dónde salió cada valor.
 * - `purge`: se borra al confirmar o rechazar. Queda solo la transcripción.
 *
 * Borrar es irreversible, así que nunca es el comportamiento por defecto: lo
 * tiene que pedir quien define la política del cliente. Hoy se elige por
 * instalación (`LAB_EVIDENCE_RETENTION`); pasa a ser por organización cuando
 * exista la configuración por cliente.
 */
export type EvidenceRetention = 'keep' | 'purge'

export function evidenceRetention(): EvidenceRetention {
  return process.env.LAB_EVIDENCE_RETENTION?.trim().toLowerCase() === 'purge' ? 'purge' : 'keep'
}
