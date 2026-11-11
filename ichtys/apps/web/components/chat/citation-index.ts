import type { Evidence } from './types'

/** Un índice faltante o duplicado vuelve ambigua toda la numeración del mensaje. */
export function hasVerifiableCitationIndices(evidences: Evidence[]): boolean {
  if (evidences.length === 0) return false
  const seen = new Set<number>()
  for (const evidence of evidences) {
    const index = evidence.citationIndex
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1 || seen.has(index)) {
      return false
    }
    seen.add(index)
  }
  return true
}

/** Devuelve la posición de la tarjeta correspondiente, nunca una posición inferida de [n]. */
export function citationEvidencePosition(evidences: Evidence[], citationIndex: number): number | null {
  if (!hasVerifiableCitationIndices(evidences)) return null
  const position = evidences.findIndex((evidence) => evidence.citationIndex === citationIndex)
  return position >= 0 ? position : null
}
