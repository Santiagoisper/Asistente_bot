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
    const normalized = plain(sentence)
    const hit = headings.find(({ heading }) => {
      if (!normalized.startsWith(heading)) return false
      const next = normalized.charAt(heading.length)
      return next === '' || /[\s:,.;-]/.test(next)
    })
    let rest = sentence
    if (hit) {
      current = hit.id
      rest = sentence.slice(hit.heading.length).replace(/^[\s:,.;-]+/, '')
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
