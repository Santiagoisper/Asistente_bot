/**
 * Correcciones dictadas (docs/decisions/consulta-dictada.md, D5).
 *
 * «Presión 140 sobre 90. Corrijo: 130 sobre 85.» → el borrador queda con el
 * valor corregido y la corrección se devuelve aparte, con los dos textos, para
 * que la pantalla los muestre y decida el médico. Nunca se descarta en silencio
 * lo que se dijo primero.
 */
export interface SpokenCorrection {
  /** Lo que se dijo primero. */
  original: string
  /** Lo que quedó en el borrador. */
  corrected: string
  /** La palabra que marcó la corrección, tal como se dijo. */
  marker: string
}

// La transcripción no siempre escribe bien la marca («corijo», «corrigo»): se aceptan las variantes cercanas.
const MARKER = /^(corr?i[jg]o|correcci[oó]n|perd[oó]n|mejor dicho|quise decir|rectifico)\b[\s:,.-]*/i
const SENTENCE = /[^.;\n]+[.;\n]?/g

function labelOf(clause: string): string | null {
  const firstDigit = clause.search(/\d/)
  if (firstDigit <= 0) return null
  return clause.slice(0, firstDigit).trimEnd()
}

export function applySpokenCorrections(text: string): { text: string; corrections: SpokenCorrection[] } {
  const sentences = (text.match(SENTENCE) ?? []).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0)
  const kept: string[] = []
  const corrections: SpokenCorrection[] = []
  for (const sentence of sentences) {
    const marker = sentence.match(MARKER)
    if (!marker) {
      kept.push(sentence)
      continue
    }
    const said = sentence.slice(marker[0].length).trim()
    const previous = kept.pop()
    if (previous === undefined || said.replace(/[.;]/g, '').trim().length === 0) {
      // Una marca sin nada que corregir o sin texto nuevo: se deja lo que había.
      if (previous !== undefined) kept.push(previous)
      continue
    }
    const original = previous.replace(/[.;]$/, '').trim()
    const label = /^\d/.test(said) ? labelOf(original) : null
    const corrected = (label ? `${label} ${said}` : said).replace(/\s+/g, ' ')
    const withStop = /[.;]$/.test(corrected) ? corrected : `${corrected}.`
    kept.push(withStop.charAt(0).toUpperCase() + withStop.slice(1))
    corrections.push({ original, corrected: withStop.replace(/[.;]$/, ''), marker: marker[1]! })
  }
  return { text: kept.join(' '), corrections }
}
