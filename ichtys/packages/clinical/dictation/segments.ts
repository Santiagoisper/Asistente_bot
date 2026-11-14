/**
 * Los tramos de lo dictado, junto a su grabación (docs/decisions/enlace-frase-audio.md).
 *
 * Un tramo es lo que el transcriptor escribió para una cosa dicha entre dos pausas, con su
 * comienzo y su fin **en la grabación entera**. No es la evolución: es el texto del
 * transcriptor, sin las correcciones de la persona. Sirve para escuchar ese pedazo y comprobar
 * si se oyó bien.
 *
 * Puro y sin dependencias: lo usan el navegador (para armarlos y reproducirlos) y el servidor
 * (para no confiar en lo que llega).
 */
import type { SpeechSegment } from './segment-speech'

export interface DictatedSegment {
  /** Comienzo en la grabación, en milisegundos. */
  startMs: number
  /** Fin en la grabación, en milisegundos. */
  endMs: number
  /** Lo que escribió el transcriptor, sin corregir. */
  text: string
}

/** PROVISORIO, sin medir con uso real: veinte minutos dictados dan del orden de 400 tramos. */
export const DICTATED_SEGMENTS_MAX = 1200
/** Un tramo dura hasta 28 segundos: más texto que esto no es algo dicho en ese tiempo. */
export const DICTATED_SEGMENT_TEXT_MAX = 2000
/**
 * La duración de la grabación viaja redondeada al segundo y los tramos se miden después de
 * llevar el audio a 16 kHz: el fin del último tramo puede pasar de la duración por esa cuenta.
 */
const DURATION_SLACK_MS = 1500

/**
 * De los tramos de voz (en muestras) y lo que el transcriptor devolvió para cada uno, a la
 * lista que se guarda. Si no corresponden uno a uno no hay lista: no se adivina cuál es cuál.
 */
export function dictatedSegments(segments: readonly SpeechSegment[], texts: readonly string[], sampleRate: number): DictatedSegment[] {
  if (!(sampleRate > 0) || segments.length !== texts.length) return []
  const out: DictatedSegment[] = []
  segments.forEach((segment, index) => {
    const text = (texts[index] ?? '').replace(/\s+/g, ' ').trim()
    if (text.length === 0) return
    out.push({
      startMs: Math.round((segment.start * 1000) / sampleRate),
      endMs: Math.round((segment.end * 1000) / sampleRate),
      text: text.slice(0, DICTATED_SEGMENT_TEXT_MAX),
    })
  })
  return out
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * Lo que llega del navegador, comprobado. `null`: no cumple y se rechaza entero. Tiempos
 * enteros, en orden, sin superponerse y dentro de la grabación; texto y cantidad con tope.
 */
export function validateDictatedSegments(input: unknown, durationSec: number): DictatedSegment[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > DICTATED_SEGMENTS_MAX) return null
  if (!Number.isFinite(durationSec) || durationSec < 0) return null
  const limitMs = durationSec * 1000 + DURATION_SLACK_MS
  const out: DictatedSegment[] = []
  let previousEnd = 0
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null
    const { startMs, endMs, text } = item as Record<string, unknown>
    if (!isCount(startMs) || !isCount(endMs) || typeof text !== 'string') return null
    if (endMs <= startMs || startMs < previousEnd || endMs > limitMs) return null
    const clean = text.trim()
    if (clean.length === 0 || clean.length > DICTATED_SEGMENT_TEXT_MAX) return null
    out.push({ startMs, endMs, text: clean })
    previousEnd = endMs
  }
  return out
}

/**
 * Desde dónde y cuánto se reproduce un tramo sobre el audio decodificado. `null`: el tramo cae
 * fuera de lo decodificado y no se reproduce; nunca suena otro pedazo en su lugar.
 */
export function segmentPlayback(segment: { startMs: number; endMs: number }, decodedDurationSec: number): { offsetSec: number; durationSec: number } | null {
  const offsetSec = segment.startMs / 1000
  if (!(decodedDurationSec > 0) || offsetSec >= decodedDurationSec) return null
  const durationSec = Math.min(segment.endMs / 1000, decodedDurationSec) - offsetSec
  return durationSec > 0 ? { offsetSec, durationSec } : null
}

/** «1:05»: dónde está el tramo en la grabación. */
export function segmentClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
