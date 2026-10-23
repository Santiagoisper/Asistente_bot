/**
 * Expande la query de búsqueda para mejorar retrieval semántico.
 *
 * Dos pasos:
 *  1. Sinónimos clínicos ES↔EN (siempre): los embeddings matchean mejor cuando
 *     la query lleva el equivalente inglés de las siglas clínicas en español
 *     (IMC↔BMI, eGFR↔glomerular filtration rate, ...). Corrida 2 del E2E
 *     2026-10-22: preguntas en español con siglas clínicas no encontraban los
 *     chunks del protocolo.
 *  2. Expansión de preguntas muy cortas (≤2 tokens) a preguntas completas.
 *
 * Se usa solo para búsqueda de chunks; la pregunta original se mantiene para el
 * answer engine y la respuesta al usuario.
 */

/**
 * Pares de sinónimos clínicos español↔inglés. `detect` son fragmentos que se
 * buscan por substring (case-insensitive) en la pregunta; `add` es el texto
 * equivalente que se apéndice a la query de retrieval si no está ya presente
 * (se chequea la primera palabra para no duplicar).
 */
const CLINICAL_SYNONYMS: ReadonlyArray<{ detect: readonly string[]; add: string }> = [
  // El `add` arranca con el equivalente (no con la sigla detectada): el chequeo
  // anti-duplicado usa la primera palabra, y la sigla original ya está en la query.
  { detect: ['imc', 'índice de masa corporal', 'indice de masa corporal'], add: 'BMI body mass index' },
  { detect: ['bmi'], add: 'IMC índice de masa corporal' },
  { detect: ['egfr', 'filtración glomerular', 'filtracion glomerular'], add: 'glomerular filtration rate GFR' },
  { detect: ['uacr'], add: 'urine albumin-to-creatinine ratio' },
  { detect: ['hba1c', 'hemoglobina glicada', 'hemoglobina glucosilada'], add: 'glycated hemoglobin HbA1c' },
  { detect: ['nefropat'], add: 'nephropathy chronic kidney disease' },
  { detect: ['aclaramiento'], add: 'renal clearance' },
]

/**
 * Apéndica los sinónimos clínicos equivalentes a la query, solo para búsqueda
 * de chunks. Si la pregunta no tiene términos clínicos conocidos, se devuelve
 * intacta.
 */
export function appendClinicalSynonyms(question: string): string {
  const q = question.toLowerCase()
  const additions = CLINICAL_SYNONYMS.filter((syn) => {
    if (!syn.detect.some((fragment) => q.includes(fragment))) return false
    // Si el equivalente ya está en la pregunta, no lo duplicamos.
    const equivalent = syn.add.split(' ')[0]?.toLowerCase() ?? syn.add.toLowerCase()
    return !q.includes(equivalent)
  }).map((syn) => syn.add)

  if (additions.length === 0) return question
  return `${question} [${additions.join('; ')}]`
}

export function expandShortQueryForRetrieval(input: {
  question: string
  studyName?: string | null
  protocolNumber?: string | null
}): string {
  const trimmed = input.question.trim()
  if (trimmed.length === 0) return trimmed

  const question = appendClinicalSynonyms(trimmed)

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
