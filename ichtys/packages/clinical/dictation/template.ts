/**
 * Bloques de la evolución dictada (docs/decisions/consulta-dictada.md, D6).
 * Provisorios: alinear con la plantilla del informe del 12/11 antes de fijarlos.
 * El médico nombra el bloque al empezar a dictarlo; lo que no nombra queda
 * «No mencionado», a la vista.
 */
export const DICTATION_BLOCKS = [
  { id: 'apertura', title: 'Apertura', headings: ['apertura'] },
  { id: 'motivo', title: 'Motivo de la visita', headings: ['motivo de la visita', 'motivo de consulta', 'motivo'] },
  { id: 'evolucion', title: 'Evolución desde la última visita', headings: ['evolucion desde la ultima visita', 'evolucion', 'enfermedad actual'] },
  { id: 'medicacion', title: 'Medicación actual y adherencia', headings: ['medicacion actual y adherencia', 'medicacion actual', 'medicacion', 'tratamiento actual'] },
  { id: 'eventos', title: 'Eventos adversos', headings: ['eventos adversos', 'evento adverso'] },
  { id: 'vitales', title: 'Signos vitales', headings: ['signos vitales'] },
  { id: 'examen', title: 'Examen físico', headings: ['examen fisico'] },
  { id: 'laboratorio', title: 'Laboratorio y estudios', headings: ['laboratorio y estudios', 'laboratorio', 'estudios complementarios'] },
  { id: 'evaluacion', title: 'Evaluación', headings: ['evaluacion', 'impresion clinica'] },
  { id: 'criterios', title: 'Criterios o desvíos', headings: ['criterios o desvios', 'criterios', 'desvios'] },
  { id: 'plan', title: 'Plan', headings: ['plan'] },
  { id: 'proxima', title: 'Próxima visita', headings: ['proxima visita', 'proximo control'] },
] as const

export type DictationBlockId = (typeof DICTATION_BLOCKS)[number]['id']

export interface DictationBlock {
  id: DictationBlockId
  title: string
  /** `null` = el médico no dictó este bloque. */
  text: string | null
}

export const NOT_MENTIONED = 'No mencionado'

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Distancia de edición entre dos textos cortos. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/**
 * ¿La frase empieza con este encabezado? Devuelve cuántas palabras ocupa.
 * La transcripción deforma palabras («signos y tales» por «signos vitales»),
 * así que se compara sin espacios y se tolera una diferencia chica. Los
 * encabezados de hasta cuatro letras («plan») tienen que venir exactos.
 */
function headingWords(words: readonly string[], heading: string): number {
  const target = heading.replace(/\s+/g, '')
  const tolerance = target.length <= 4 ? 0 : Math.max(1, Math.floor(target.length * 0.25))
  const size = heading.split(' ').length
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const count of [size, size + 1, size - 1]) {
    if (count < 1 || count > words.length) continue
    const distance = editDistance(words.slice(0, count).join(''), target)
    if (distance <= tolerance && distance < bestDistance) {
      best = count
      bestDistance = distance
    }
  }
  return best
}

/**
 * Parte el texto en bloques. Un encabezado vale solo al comienzo de una frase
 * («Signos vitales: …», «Plan. …»): la misma palabra en medio de una frase es
 * texto. Lo dictado antes del primer encabezado va a la apertura.
 */
export function splitIntoBlocks(text: string): DictationBlock[] {
  const sentences = (text.match(/[^.;\n]+[.;\n]?/g) ?? []).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0)
  const headings = DICTATION_BLOCKS.flatMap((block) => block.headings.map((heading) => ({ id: block.id, heading })))
    .sort((a, b) => b.heading.length - a.heading.length)
  const parts = new Map<DictationBlockId, string[]>()
  let current: DictationBlockId = 'apertura'
  for (const sentence of sentences) {
    const rawWords = sentence.split(/\s+/)
    const words = rawWords.map((word) => plain(word).replace(/[^a-z0-9]/g, ''))
    let rest = sentence
    for (const { id, heading } of headings) {
      const count = headingWords(words, heading)
      if (count === 0) continue
      current = id
      rest = rawWords.slice(count).join(' ').replace(/^[\s:,.;-]+/, '')
      break
    }
    if (rest.replace(/[.;]/g, '').trim().length === 0) continue
    const list = parts.get(current) ?? []
    list.push(rest.charAt(0).toUpperCase() + rest.slice(1))
    parts.set(current, list)
  }
  return DICTATION_BLOCKS.map((block) => ({
    id: block.id,
    title: block.title,
    text: parts.has(block.id) ? parts.get(block.id)!.join(' ') : null,
  }))
}
