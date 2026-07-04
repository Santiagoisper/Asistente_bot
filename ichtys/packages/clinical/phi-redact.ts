/**
 * Pre-redacción de identificadores antes de enviar texto a terceros LLM.
 * Alineado con detectPossiblePii (apps/web) — aquí sí muta el texto.
 */

const REDACTED = '[REDACTED]'

export interface PhiRedactionResult {
  text: string
  redactedCount: number
}

export function redactPhiForLlm(text: string): PhiRedactionResult {
  let redactedCount = 0
  let result = text

  result = result.replace(/\b\d{7,8}\b/g, () => {
    redactedCount += 1
    return REDACTED
  })

  result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, () => {
    redactedCount += 1
    return REDACTED
  })

  result = result.replace(/\b(?:\+54\s?)?(?:11|15)[\s-]?\d{4}[\s-]?\d{4}\b/g, () => {
    redactedCount += 1
    return REDACTED
  })

  return { text: result, redactedCount }
}
