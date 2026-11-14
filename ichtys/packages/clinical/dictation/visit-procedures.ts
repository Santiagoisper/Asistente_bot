/**
 * Los procedimientos de la visita según el cronograma del protocolo
 * (docs/decisions/consulta-dictada.md, D21).
 *
 * La persona escribe qué visita es («Visita 3», «V3», «Selección», «Semana 4») y la guía
 * muestra lo que el cronograma del protocolo pide para esa visita. Es un recordatorio: acá
 * no se comprueba que cada procedimiento esté en el texto dictado.
 *
 * Si lo escrito señala más de una visita, o ninguna, no se elige: mostrar los
 * procedimientos de otra visita es peor que no mostrar nada.
 */
export interface ProtocolVisit {
  /** Como figura en el cronograma: «Visita 4», «V6». */
  name: string
  /** Etiqueta de tiempo, si el protocolo la trae: «Semana 12». */
  label: string | null
  procedures: readonly string[]
  /** Páginas del protocolo de donde salió. */
  sourcePages?: readonly number[]
}

/** «Visita 2 (Aleatorización)» → v · 2 · aleatorizacion. «V2» y «Visita 2» dan lo mismo; «-4» conserva el signo. */
function tokens(text: string): string[] {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return (plain.match(/-?\d+|[a-z]+/g) ?? []).map((token) => (token === 'visita' || token === 'visit' ? 'v' : token))
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index])
}

/** ¿`part` aparece entero y seguido dentro de `whole`? Palabra por palabra: «1» no está en «12». */
function contains(whole: readonly string[], part: readonly string[]): boolean {
  for (let start = 0; start + part.length <= whole.length; start++) {
    if (part.every((token, index) => token === whole[start + index])) return true
  }
  return false
}

export function matchProtocolVisit(typed: string, visits: readonly ProtocolVisit[]): ProtocolVisit | null {
  const wanted = tokens(typed)
  if (wanted.length === 0) return null
  const keys = visits.map((visit) => [tokens(visit.name), visit.label ? tokens(visit.label) : []] as const)
  // Primero el nombre o la etiqueta completos; si no, una parte que señale una sola visita.
  for (const test of [same, contains]) {
    const found = visits.filter((_, index) => keys[index]!.some((key) => key.length > 0 && test(key, wanted)))
    if (found.length === 1) return found[0]!
    if (found.length > 1) return null
  }
  return null
}
