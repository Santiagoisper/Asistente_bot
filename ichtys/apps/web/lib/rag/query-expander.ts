/**
 * Expande preguntas muy cortas para mejorar retrieval semántico.
 *
 * Se usa solo para búsqueda de chunks; la pregunta original se mantiene para el
 * answer engine y la respuesta al usuario.
 */
export function expandShortQueryForRetrieval(input: {
  question: string
  studyName?: string | null
  protocolNumber?: string | null
}): string {
  const question = input.question.trim()
  if (question.length === 0) return question

  const tokens = question
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length > 2) return question

  const context = [input.studyName, input.protocolNumber].filter(Boolean).join(' · ') || 'actual'
  const normalized = tokens.join(' ')

  if (normalized.includes('visita')) {
    return `Según el protocolo ${context}, ¿cuáles son las visitas, ventanas y procedimientos por visita?`
  }
  if (normalized.includes('criterio') || normalized.includes('inclusion') || normalized.includes('exclusion')) {
    return `Según el protocolo ${context}, ¿cuáles son los criterios de inclusión y exclusión?`
  }
  if (normalized.includes('medic')) {
    return `Según el protocolo ${context}, ¿qué medicación concomitante está prohibida o restringida?`
  }

  return `Según los documentos del estudio ${context}, responder sobre: ${question}`
}
