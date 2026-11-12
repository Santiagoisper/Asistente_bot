/**
 * Bucles de repetición del transcriptor (docs/decisions/consulta-dictada.md, D10).
 *
 * Un modelo de voz a texto a veces se traba y devuelve la misma frase muchas
 * veces seguidas: texto que nadie dijo. Pasó con voz real el 12/11/2026. Acá se
 * detecta, se deja una sola aparición y se informa: en ese tramo es probable que
 * falte lo que la persona dijo de verdad, así que el aviso pide volver a mirarlo.
 * Nunca se quita en silencio.
 */
export interface RepetitionNotice {
  /** La frase repetida, como quedó (una vez). */
  phrase: string
  /** Cuántas veces seguidas la devolvió el transcriptor. */
  times: number
}

const MIN_WORDS = 3
const MAX_WORDS = 14
/** Tres veces seguidas la misma frase de tres palabras o más no es habla: es un bucle. */
const MIN_TIMES = 3

const key = (word: string): string =>
  word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export function collapseRepetitions(text: string): { text: string; repetitions: RepetitionNotice[] } {
  const words = text.split(/\s+/).filter(Boolean)
  const keys = words.map(key)
  const out: string[] = []
  const repetitions: RepetitionNotice[] = []

  let i = 0
  while (i < words.length) {
    let collapsed = false
    // De menor a mayor: así se encuentra la frase y no dos o tres frases pegadas.
    const largest = Math.min(MAX_WORDS, Math.floor((words.length - i) / MIN_TIMES))
    for (let size = MIN_WORDS; size <= largest; size++) {
      let times = 1
      while (i + (times + 1) * size <= words.length) {
        let same = true
        for (let k = 0; k < size; k++) {
          if (keys[i + k] !== keys[i + times * size + k]) {
            same = false
            break
          }
        }
        if (!same) break
        times++
      }
      if (times >= MIN_TIMES) {
        const phrase = words.slice(i, i + size)
        out.push(...phrase)
        repetitions.push({ phrase: phrase.join(' ').replace(/[,;:.]+$/, ''), times })
        i += times * size
        collapsed = true
        break
      }
    }
    if (!collapsed) {
      out.push(words[i]!)
      i++
    }
  }
  return { text: out.join(' '), repetitions }
}
