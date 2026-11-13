/**
 * Correcciones dictadas (docs/decisions/consulta-dictada.md, D5).
 *
 * «Presión 140 sobre 90. Corrijo: 130 sobre 85.» → el borrador queda con el
 * valor corregido y la corrección se devuelve aparte, con los dos textos, para
 * que la pantalla los muestre y decida el médico. Nunca se descarta en silencio
 * lo que se dijo primero.
 */
import { splitClauses, type Clause } from './clauses'

export interface SpokenCorrection {
  /** Lo que se dijo primero. */
  original: string
  /** Lo que quedó en el borrador. */
  corrected: string
  /** La palabra que marcó la corrección, tal como se dijo. */
  marker: string
}

/** Las palabras que marcan una corrección, como se le enseñan a quien dicta. Una prueba las ata a MARKER. */
export const CORRECTION_WORDS = ['corrijo', 'corrección', 'perdón', 'mejor dicho', 'quise decir', 'rectifico'] as const

// La transcripción no siempre escribe bien la marca («corijo», «corrigo»): se aceptan las variantes cercanas.
const MARKER = /^(corr?i[jg]o|correcci[oó]n|perd[oó]n|mejor dicho|quise decir|rectifico)\b[\s:,.-]*/i
/** Hasta cuántos tramos hacia atrás se busca lo que se está corrigiendo. */
const LOOK_BACK = 3

function labelOf(clause: string): string | null {
  const firstDigit = clause.search(/\d/)
  if (firstDigit <= 0) return null
  return clause.slice(0, firstDigit).trimEnd()
}

const firstWord = (text: string): string =>
  (text.trim().split(/\s+/)[0] ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * Qué tramo de los ya dichos se corrige. Si la corrección es solo un valor («corrijo, 132
 * sobre 84»), el último tramo que tenía un número. Si nombra el dato («corrijo, presión 132
 * sobre 84»), el último tramo que empieza con esa palabra. Si no hay ninguno, el anterior.
 */
function targetOf(kept: readonly Clause[], said: string): number {
  if (kept.length === 0) return -1
  const from = kept.length - 1
  const to = Math.max(0, kept.length - LOOK_BACK)
  const startsWithNumber = /^\d/.test(said)
  const word = firstWord(said)
  for (let index = from; index >= to; index--) {
    const clause = kept[index]!.text
    if (startsWithNumber ? /\d/.test(clause) : word.length > 0 && firstWord(labelTail(clause)) === word) return index
  }
  return from
}

/** «Signos vitales: presión arterial 140 sobre 90» → «presión arterial 140 sobre 90»: el dato, sin el título del apartado. */
function labelTail(clause: string): string {
  const colon = clause.lastIndexOf(': ')
  return colon >= 0 ? clause.slice(colon + 2) : clause
}

export function applySpokenCorrections(text: string): { text: string; corrections: SpokenCorrection[] } {
  // Tramos, no frases: quien dicta de corrido dice «140 sobre 90, corrijo, 132 sobre 84» sin
  // pausa y el transcriptor lo escribe con comas.
  const clauses = splitClauses(text, '.;,\n')
  const kept: Clause[] = []
  const corrections: SpokenCorrection[] = []
  for (let index = 0; index < clauses.length; index++) {
    const clause = clauses[index]!
    const marker = clause.text.match(MARKER)
    if (!marker) {
      kept.push({ ...clause })
      continue
    }
    let said = clause.text.slice(marker[0].length).trim()
    let delimiter = clause.delimiter
    // «Corrijo, 132 sobre 84»: la marca quedó sola en su tramo y el valor viene en el siguiente.
    if (said.length === 0 && clause.delimiter === ',' && index + 1 < clauses.length) {
      index++
      said = clauses[index]!.text
      delimiter = clauses[index]!.delimiter
    }
    const target = targetOf(kept, said)
    // Una marca sin nada que corregir o sin texto nuevo: se deja lo que había.
    if (target < 0 || said.length === 0) continue

    const original = kept[target]!.text
    const label = /^\d/.test(said) ? labelOf(original) : null
    const head = label ? null : original.slice(0, original.length - labelTail(original).length)
    let corrected = (label ? `${label} ${said}` : `${head ?? ''}${said}`).replace(/\s+/g, ' ').trim()
    if (/^\p{Lu}/u.test(original)) corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1)
    kept[target] = { text: corrected, delimiter: target === kept.length - 1 ? delimiter : kept[target]!.delimiter }
    corrections.push({ original, corrected, marker: marker[1]! })
  }

  const joined = kept.map((clause) => clause.text + clause.delimiter).join(' ').trim()
  return { text: joined.length === 0 || /[.;!?]$/.test(joined) ? joined : `${joined.replace(/[,:]+$/, '')}.`, corrections }
}
