/**
 * Audio del dictado (docs/decisions/consulta-dictada.md, D1 y D3).
 * Todo ocurre en el navegador: el audio se decodifica, se lleva a 16 kHz mono
 * y se marca dónde hay voz, cortando por las pausas (D15). Acá no se sube nada.
 */
import { segmentSpeech, type SpeechSegment } from '@ichtys/clinical'

export const TARGET_SAMPLE_RATE = 16_000

/** Promedio de los canales. Un solo canal vuelve tal cual. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]!
  const length = Math.min(...channels.map((channel) => channel.length))
  const out = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i]! += channel[i]! / channels.length
  }
  return out
}

/** Remuestreo lineal. Alcanza para voz; el navegador usa su propio remuestreador cuando puede. */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate))
  const out = new Float32Array(length)
  const step = fromRate / toRate
  for (let i = 0; i < length; i++) {
    const position = i * step
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const weight = position - left
    out[i] = samples[left]! * (1 - weight) + samples[right]! * weight
  }
  return out
}

export interface PreparedAudio {
  /** Todo lo grabado, a 16 kHz mono. */
  samples: Float32Array
  /** Los tramos de voz, uno por cada cosa dicha entre dos pausas. Vacío: no hay voz. */
  segments: SpeechSegment[]
  /** Duración de lo grabado (segundos). */
  durationSec: number
}

/** De un archivo o una grabación a muestras listas para transcribir. Solo en el navegador. */
export async function prepareAudio(blob: Blob): Promise<PreparedAudio> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    const mono = resampleLinear(mixToMono(channels), decoded.sampleRate, TARGET_SAMPLE_RATE)
    return { samples: mono, segments: segmentSpeech(mono, TARGET_SAMPLE_RATE), durationSec: Math.round(decoded.duration) }
  } finally {
    void context.close()
  }
}
