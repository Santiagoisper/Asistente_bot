/**
 * Corta un texto dictado en tramos. Un signo corta solo si después viene un espacio
 * o el final: «7,9 %» y «0.9 mg/dL» son un número, no dos tramos.
 */
export interface Clause {
  /** El tramo, sin el signo que lo cierra. */
  text: string
  /** El signo que lo cierra, o '' si el texto termina sin signo. */
  delimiter: string
}

export function splitClauses(text: string, delimiters: string): Clause[] {
  const clauses: Clause[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (!delimiters.includes(char)) continue
    const next = text[i + 1]
    if (char !== '\n' && next !== undefined && !/\s/.test(next)) continue
    const piece = text.slice(start, i).trim()
    if (piece.length > 0) clauses.push({ text: piece, delimiter: char === '\n' ? '.' : char })
    start = i + 1
  }
  const tail = text.slice(start).trim()
  if (tail.length > 0) clauses.push({ text: tail, delimiter: '' })
  return clauses
}
