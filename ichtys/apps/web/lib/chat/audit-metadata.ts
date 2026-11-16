/**
 * Lista cerrada de claves de metadata de auditoría del chat (PR-B del chat
 * cifrado, 2026-11-16; diseño de Architect 7a7b2edf, punto e).
 *
 * El chat no guarda la pregunta ni la respuesta: la auditoría del pedido y de
 * la respuesta solo lleva configuración, cuentas y códigos. Esta lista es la
 * frontera: una clave nueva en la metadata de estas acciones tiene que
 * sumarse ACÁ a mano (y su prueba la enumera), nunca meterse directo en la
 * ruta. Si algún día hace falta llevar texto, es una decisión de diseño, no
 * un agregado.
 */
export const CHAT_AUDIT_METADATA_KEYS = {
  'rag.answer.requested': ['documentType', 'topK', 'historyTurns', 'streaming'],
  'rag.answer.completed': ['confidence', 'evidenceCount', 'retrievalCount', 'annotationCount', 'streaming'],
  'rag.answer.failed': ['error'],
} as const

export type ChatAuditAction = keyof typeof CHAT_AUDIT_METADATA_KEYS

/**
 * Arma la metadata de auditoría del chat validando contra la lista cerrada:
 * una clave que no está en la lista hace fallar el armado (y con él la
 * transacción o el registro), en lugar de entrar silenciosamente.
 */
export function buildChatAuditMetadata(
  action: ChatAuditAction,
  values: Partial<Record<(typeof CHAT_AUDIT_METADATA_KEYS)[ChatAuditAction][number], unknown>>,
): Record<string, unknown> {
  const allowed = CHAT_AUDIT_METADATA_KEYS[action]
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key as never)) {
      throw new Error(`chat audit metadata: clave fuera de la lista cerrada para ${action}: ${key}`)
    }
    out[key] = value
  }
  return out
}
