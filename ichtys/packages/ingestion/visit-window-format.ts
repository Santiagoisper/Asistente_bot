import { normalizeVisitWindow } from '@ichtys/clinical'

const MINUS = '\u2212'

/**
 * Único texto de ventana (ADR-7 §2.2). Simétrica `±3 d`, asimétrica `−2/+3 d`,
 * sin datos `—`. Lee solo por `normalizeVisitWindow`.
 */
export function formatVisitWindow(visit: {
  windowDays?: number | null
  windowBefore?: number | null
  windowAfter?: number | null
}): string {
  const { before, after } = normalizeVisitWindow(visit)
  if (before === null || after === null) return '—'
  if (before === after) return `±${before} d`
  return `${MINUS}${before}/+${after} d`
}
