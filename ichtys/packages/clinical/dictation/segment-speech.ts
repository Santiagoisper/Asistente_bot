/**
 * Corta el audio en tramos de voz, por las pausas (docs/decisions/consulta-dictada.md, D15).
 *
 * Por qué: con ventanas fijas de 30 segundos, el transcriptor a veces da por terminada la
 * ventana después de la primera frase y pierde todo lo que sigue hasta la ventana
 * siguiente. Pasó con voz real el 12/11/2026: de 75 segundos leídos se perdieron unos
 * veinte, con la edad, el motivo, la evolución y la medicación adentro. Si cada pedido al
 * modelo lleva un solo tramo de voz, no hay «lo que sigue» que se pueda perder, y ninguna
 * palabra queda partida entre dos ventanas.
 *
 * Puro: recibe muestras mono y devuelve posiciones. No toca el audio.
 */
export interface SpeechSegment {
  /** Primera muestra del tramo. */
  start: number
  /** Una después de la última. */
  end: number
}

export interface SegmentSpeechOptions {
  /** Piso de amplitud RMS por debajo del cual un instante es silencio. */
  threshold?: number
  /** Una pausa más corta que esto no corta el tramo (segundos). */
  minPauseSec?: number
  /** Aire que se deja antes y después de cada tramo (segundos). */
  padSec?: number
  /** Un tramo con menos voz que esto es un ruido, no una palabra (segundos). */
  minSpeechSec?: number
  /** El modelo escucha hasta 30 segundos: un tramo más largo se parte en su punto más callado. */
  maxSegmentSec?: number
}

const FRAME_SEC = 0.02

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!
}

export function segmentSpeech(samples: Float32Array, sampleRate: number, options: SegmentSpeechOptions = {}): SpeechSegment[] {
  const minPauseSec = options.minPauseSec ?? 0.7
  const padSec = options.padSec ?? 0.15
  const minSpeechSec = options.minSpeechSec ?? 0.2
  const maxSegmentSec = options.maxSegmentSec ?? 28
  if (samples.length === 0 || sampleRate <= 0) return []

  const frame = Math.max(1, Math.round(sampleRate * FRAME_SEC))
  const energy: number[] = []
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    energy.push(Math.sqrt(sum / (end - start)))
  }
  // El piso se adapta a la grabación: con un micrófono fuerte, el ruido de fondo pasa de 0,01.
  const loud = percentile([...energy].sort((a, b) => a - b), 0.95)
  const threshold = Math.max(options.threshold ?? 0.01, loud * 0.1)

  // Tramos con voz, en cuadros.
  const runs: Array<[number, number]> = []
  let runStart = -1
  for (let i = 0; i < energy.length; i++) {
    if (energy[i]! >= threshold) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      runs.push([runStart, i])
      runStart = -1
    }
  }
  if (runStart >= 0) runs.push([runStart, energy.length])

  // Una pausa corta no corta: se unen los tramos vecinos.
  const minPauseFrames = minPauseSec / FRAME_SEC
  const joined: Array<[number, number, number]> = []
  for (const [from, to] of runs) {
    const last = joined[joined.length - 1]
    if (last && from - last[1] < minPauseFrames) {
      last[1] = to
      last[2] += to - from
    } else joined.push([from, to, to - from])
  }

  const padFrames = Math.round(padSec / FRAME_SEC)
  const maxFrames = Math.floor(maxSegmentSec / FRAME_SEC)
  const segments: SpeechSegment[] = []
  const push = (from: number, to: number) => {
    if (to - from > maxFrames) {
      // Demasiado largo: se parte en el cuadro más callado de la segunda mitad de lo que entra.
      let cut = from + Math.floor(maxFrames / 2)
      for (let i = cut; i < from + maxFrames; i++) if (energy[i]! < energy[cut]!) cut = i
      push(from, cut)
      push(cut, to)
      return
    }
    segments.push({ start: Math.max(0, from * frame), end: Math.min(samples.length, to * frame) })
  }
  const voiced = joined.filter(([, , frames]) => frames * FRAME_SEC >= minSpeechSec)
  voiced.forEach(([from, to], index) => {
    // El aire no se mete en el tramo vecino.
    const previousEnd = index > 0 ? voiced[index - 1]![1] : 0
    const nextStart = index < voiced.length - 1 ? voiced[index + 1]![0] : energy.length
    push(Math.max(from - padFrames, Math.ceil((previousEnd + from) / 2), 0), Math.min(to + padFrames, Math.floor((to + nextStart) / 2), energy.length))
  })
  return segments
}

/**
 * Une lo que el modelo devolvió para cada tramo. Cada tramo es algo que la persona dijo
 * entre dos pausas: se cierra con punto si el modelo no lo cerró, y así las pausas de
 * quien dicta son las que separan las frases, no lo que adivine el modelo.
 */
export function joinSegmentTexts(texts: readonly string[]): string {
  return texts
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter((text) => text.replace(/[\s.,;:!?¡¿-]/g, '').length > 0)
    .map((text) => {
      const closed = /[.!?;:,]$/.test(text) ? text.replace(/[,:;]$/, '.') : `${text}.`
      return closed.charAt(0).toUpperCase() + closed.slice(1)
    })
    .join(' ')
}
