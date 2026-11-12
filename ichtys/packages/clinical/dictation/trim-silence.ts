/**
 * Recorte de silencios antes de transcribir (docs/decisions/consulta-dictada.md, D3).
 * Puro: recibe muestras mono y devuelve muestras mono. Un silencio largo se
 * acorta, no se elimina: queda una pausa corta para que el modelo siga
 * separando frases.
 */
export interface TrimSilenceOptions {
  /** Amplitud RMS por debajo de la cual un tramo cuenta como silencio. */
  threshold?: number
  /** Silencios más cortos que esto no se tocan (segundos). */
  minSilenceSec?: number
  /** Pausa que se conserva de cada silencio largo (segundos). */
  keepSec?: number
}

const FRAME_SEC = 0.02

export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  options: TrimSilenceOptions = {},
): { samples: Float32Array; removedSec: number } {
  const threshold = options.threshold ?? 0.01
  const minSilenceSec = options.minSilenceSec ?? 0.8
  const keepSec = Math.min(options.keepSec ?? 0.3, minSilenceSec)
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SEC))
  if (samples.length === 0 || sampleRate <= 0) return { samples, removedSec: 0 }

  const keepRanges: Array<[number, number]> = []
  const keepHalf = Math.round((keepSec * sampleRate) / 2)
  let voicedStart = 0
  let silenceStart = -1
  const closeSilence = (silenceEnd: number) => {
    if (silenceStart < 0) return
    const length = silenceEnd - silenceStart
    if (length >= minSilenceSec * sampleRate) {
      keepRanges.push([voicedStart, silenceStart + keepHalf])
      voicedStart = silenceEnd - keepHalf
    }
    silenceStart = -1
  }
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame)
    let energy = 0
    for (let i = start; i < end; i++) energy += samples[i]! * samples[i]!
    const silent = Math.sqrt(energy / (end - start)) < threshold
    if (silent) {
      if (silenceStart < 0) silenceStart = start
    } else {
      closeSilence(start)
    }
  }
  closeSilence(samples.length)
  keepRanges.push([voicedStart, samples.length])

  const total = keepRanges.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0)
  if (total >= samples.length) return { samples, removedSec: 0 }
  const out = new Float32Array(total)
  let offset = 0
  for (const [from, to] of keepRanges) {
    if (to <= from) continue
    out.set(samples.subarray(from, to), offset)
    offset += to - from
  }
  return { samples: out, removedSec: (samples.length - total) / sampleRate }
}
