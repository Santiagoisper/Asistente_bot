/**
 * En qué estado está una grabación (docs/decisions/consulta-dictada.md, D14, y
 * docs/decisions/grabacion-en-sujeto-equivocado.md, D24). Sin dependencias: lo usan el listado,
 * la escucha y la pantalla, para que digan lo mismo.
 *
 * - `available`: tiene contenido y está dentro del plazo.
 * - `expired`: venció. Se borró el contenido, o está por borrarse: no se entrega.
 * - `withdrawn`: se retiró de este sujeto porque la evolución se registró en el equivocado.
 *   Su contenido no se borró: pasó al depósito de grabaciones sin sujeto. Pesa más que
 *   `expired`: lo que hay que decir de ella es que se retiró.
 */
export type AudioState = 'available' | 'expired' | 'withdrawn'

export function audioState(row: { hasContent: boolean; expiresAt: Date; purgedAt: Date | null; withdrawnAt: Date | null }, now: Date): AudioState {
  if (row.withdrawnAt !== null) return 'withdrawn'
  if (!row.hasContent || row.purgedAt !== null || row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'available'
}
