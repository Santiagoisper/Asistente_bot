import { describe, expect, it } from 'vitest'
import { DICTATED_SEGMENTS_MAX, DICTATED_SEGMENT_TEXT_MAX, dictatedSegments, segmentPlayback, segmentSpeech, validateDictatedSegments } from '../dictation'

/**
 * Los tramos de lo dictado (docs/decisions/enlace-frase-audio.md): lo que el transcriptor
 * escribió para cada cosa dicha entre dos pausas, con su comienzo y su fin en la grabación.
 */
describe('dictatedSegments', () => {
  it('pasa de muestras a milisegundos y limpia el texto', () => {
    const out = dictatedSegments([{ start: 16_000, end: 40_000 }, { start: 48_000, end: 64_000 }], ['  Paciente de 58   años ', 'Presión 132 84.'], 16_000)
    expect(out).toEqual([
      { startMs: 1000, endMs: 2500, text: 'Paciente de 58 años' },
      { startMs: 3000, endMs: 4000, text: 'Presión 132 84.' },
    ])
  })

  it('un tramo del que el transcriptor no escribió nada no se lista, y los demás conservan su tiempo', () => {
    const out = dictatedSegments([{ start: 0, end: 16_000 }, { start: 32_000, end: 48_000 }], ['  ', 'Sin eventos adversos'], 16_000)
    expect(out).toEqual([{ startMs: 2000, endMs: 3000, text: 'Sin eventos adversos' }])
  })

  it('si los textos no corresponden uno a uno con los tramos, no hay lista: no se adivina cuál es cuál', () => {
    expect(dictatedSegments([{ start: 0, end: 16_000 }, { start: 32_000, end: 48_000 }], ['uno solo'], 16_000)).toEqual([])
    expect(dictatedSegments([{ start: 0, end: 16_000 }], ['uno'], 0)).toEqual([])
  })

  it('un silencio largo al principio: el primer tramo apunta a su tiempo real, no a cero', () => {
    const rate = 16_000
    const samples = new Float32Array(rate * 8)
    // Cinco segundos callados, después dos de voz.
    for (let i = rate * 5; i < rate * 7; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate)
    const segments = segmentSpeech(samples, rate)
    expect(segments).toHaveLength(1)
    const [first] = dictatedSegments(segments, ['Visita tres del estudio'], rate)
    expect(first!.startMs).toBeGreaterThan(4500)
    expect(first!.startMs).toBeLessThanOrEqual(5000)
    expect(first!.endMs).toBeGreaterThanOrEqual(7000)
    expect(first!.endMs).toBeLessThan(7500)
  })
})

describe('validateDictatedSegments', () => {
  const good = [
    { startMs: 1000, endMs: 2500, text: 'Paciente de 58 años' },
    { startMs: 2500, endMs: 4000, text: 'Presión 132 84' },
  ]

  it('acepta una lista en orden y dentro de la grabación, y devuelve solo los tres campos', () => {
    expect(validateDictatedSegments(good.map((s) => ({ ...s, extra: 'x' })), 4)).toEqual(good)
  })

  it('la duración viene redondeada al segundo: un fin que pasa por menos de un segundo y medio vale', () => {
    expect(validateDictatedSegments([{ startMs: 0, endMs: 5400, text: 'a' }], 4)).not.toBeNull()
    expect(validateDictatedSegments([{ startMs: 0, endMs: 5600, text: 'a' }], 4)).toBeNull()
  })

  it.each([
    ['no es una lista', { segments: good }],
    ['lista vacía', []],
    ['un tramo que no es un objeto', [null]],
    ['tiempos al revés', [{ startMs: 2000, endMs: 1000, text: 'a' }]],
    ['tramo sin largo', [{ startMs: 1000, endMs: 1000, text: 'a' }]],
    ['tiempo negativo', [{ startMs: -1, endMs: 1000, text: 'a' }]],
    ['tiempo con decimales', [{ startMs: 0.5, endMs: 1000, text: 'a' }]],
    ['tiempo como texto', [{ startMs: '0', endMs: 1000, text: 'a' }]],
    ['superpuestos', [good[0], { startMs: 2000, endMs: 3000, text: 'b' }]],
    ['fuera de orden', [good[1], good[0]]],
    ['pasa de la grabación', [{ startMs: 0, endMs: 60_000, text: 'a' }]],
    ['texto vacío', [{ startMs: 0, endMs: 1000, text: '   ' }]],
    ['texto que no es texto', [{ startMs: 0, endMs: 1000, text: 7 }]],
    ['texto demasiado largo', [{ startMs: 0, endMs: 1000, text: 'a'.repeat(DICTATED_SEGMENT_TEXT_MAX + 1) }]],
  ])('rechaza entero: %s', (_name, input) => {
    expect(validateDictatedSegments(input, 4)).toBeNull()
  })

  it('rechaza más tramos que el tope', () => {
    const many = Array.from({ length: DICTATED_SEGMENTS_MAX + 1 }, (_, i) => ({ startMs: i * 10, endMs: i * 10 + 10, text: 'a' }))
    expect(validateDictatedSegments(many, 3600)).toBeNull()
    expect(validateDictatedSegments(many.slice(0, DICTATED_SEGMENTS_MAX), 3600)).not.toBeNull()
  })

  it('una duración que no sirve rechaza todo', () => {
    expect(validateDictatedSegments(good, Number.NaN)).toBeNull()
    expect(validateDictatedSegments(good, -1)).toBeNull()
  })
})

describe('segmentPlayback', () => {
  it('desde dónde y cuánto, en segundos', () => {
    expect(segmentPlayback({ startMs: 5000, endMs: 7250 }, 20)).toEqual({ offsetSec: 5, durationSec: 2.25 })
  })

  it('no pasa del final de lo decodificado', () => {
    expect(segmentPlayback({ startMs: 5000, endMs: 9000 }, 6)).toEqual({ offsetSec: 5, durationSec: 1 })
  })

  it('un tramo que empieza después del final no se reproduce: nunca suena otro pedazo en su lugar', () => {
    expect(segmentPlayback({ startMs: 9000, endMs: 9500 }, 6)).toBeNull()
    expect(segmentPlayback({ startMs: 0, endMs: 500 }, 0)).toBeNull()
  })
})
