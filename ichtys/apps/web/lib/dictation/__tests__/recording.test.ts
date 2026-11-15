import { describe, expect, it, vi } from 'vitest'
import { pickRecordingMimeType, recordingBudget, takeLimitNotice } from '../recording'

/**
 * El grabador pide 24 kbps, pero es un pedido: medido el 14/11/2026, donde el navegador graba
 * en mp4 sale a unos 187 kbps y el tope de 4 MB por grabación se alcanza a los 2:50. Antes, una
 * toma más larga perdía la grabación entera sin avisar hasta el final.
 */
describe('pickRecordingMimeType — qué formato se le pide al navegador', () => {
  const supports = (...types: string[]) => (type: string) => types.includes(type)
  const decodes = (...types: string[]) => vi.fn(async (type: string) => types.includes(type))

  it('prefiere webm con opus, que sí respeta la calidad pedida, si el equipo lo graba y lo decodifica', async () => {
    const type = await pickRecordingMimeType(supports('audio/webm;codecs=opus', 'audio/mp4'), decodes('audio/webm;codecs=opus'))
    expect(type).toBe('audio/webm;codecs=opus')
  })

  it('si no hay webm, prueba ogg con opus', async () => {
    expect(await pickRecordingMimeType(supports('audio/ogg;codecs=opus'), decodes('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus')
  })

  it('un formato que el equipo graba pero no decodifica no se elige: después no se podría transcribir', async () => {
    expect(await pickRecordingMimeType(supports('audio/webm;codecs=opus'), decodes())).toBeUndefined()
  })

  it('si webm se graba pero no se decodifica, sigue con ogg', async () => {
    const both = supports('audio/webm;codecs=opus', 'audio/ogg;codecs=opus')
    expect(await pickRecordingMimeType(both, decodes('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus')
  })

  it('no gasta la prueba de decodificación en un formato que el equipo no graba', async () => {
    const canDecode = decodes('audio/webm;codecs=opus', 'audio/ogg;codecs=opus')
    expect(await pickRecordingMimeType(supports('audio/mp4'), canDecode)).toBeUndefined()
    expect(canDecode).not.toHaveBeenCalled()
  })

  it('si la consulta al navegador falla, no pide formato', async () => {
    const broken = () => {
      throw new Error('no disponible')
    }
    expect(await pickRecordingMimeType(broken, decodes('audio/webm;codecs=opus'))).toBeUndefined()
  })

  it('si la prueba de decodificación falla, no pide formato', async () => {
    const rejects = async () => {
      throw new Error('no se pudo probar')
    }
    expect(await pickRecordingMimeType(supports('audio/webm;codecs=opus'), rejects)).toBeUndefined()
  })
})

describe('recordingBudget — cuánto falta para el tope de la grabación', () => {
  const MAX = 4_000_000

  it('a 24 kbps (3 kB por segundo) falta mucho: no corta y no avisa todavía', () => {
    const budget = recordingBudget({ bytes: 30_000, seconds: 10, lastChunkBytes: 3_000, maxBytes: MAX })
    expect(budget.stop).toBe(false)
    expect(budget.secondsLeft).toBe(1323)
  })

  it('a 187 kbps (23,4 kB por segundo) a los 2 minutos quedan unos 50 segundos', () => {
    const budget = recordingBudget({ bytes: 2_808_000, seconds: 120, lastChunkBytes: 23_400, maxBytes: MAX })
    expect(budget.stop).toBe(false)
    expect(budget.secondsLeft).toBe(50)
  })

  it('corta cuando el próximo tramo ya no entraría con margen', () => {
    const budget = recordingBudget({ bytes: 3_960_000, seconds: 169, lastChunkBytes: 23_400, maxBytes: MAX })
    expect(budget.stop).toBe(true)
    expect(budget.secondsLeft).toBe(0)
  })

  it('nunca deja pasar el tope: con lo grabado ya en el límite, corta', () => {
    expect(recordingBudget({ bytes: MAX, seconds: 60, lastChunkBytes: 1, maxBytes: MAX }).stop).toBe(true)
    expect(recordingBudget({ bytes: MAX + 1, seconds: 60, lastChunkBytes: 0, maxBytes: MAX }).stop).toBe(true)
  })

  it('en los primeros segundos no estima: todavía no hay con qué', () => {
    const budget = recordingBudget({ bytes: 5_000, seconds: 1, lastChunkBytes: 5_000, maxBytes: MAX })
    expect(budget).toEqual({ stop: false, secondsLeft: null })
  })

  it('sin datos todavía no corta ni estima', () => {
    expect(recordingBudget({ bytes: 0, seconds: 0, lastChunkBytes: 0, maxBytes: MAX })).toEqual({ stop: false, secondsLeft: null })
  })
})

describe('takeLimitNotice — lo que lee quien dicta', () => {
  it('con más de un minuto por delante no dice nada', () => {
    expect(takeLimitNotice({ stop: false, secondsLeft: 61 })).toBeNull()
    expect(takeLimitNotice({ stop: false, secondsLeft: null })).toBeNull()
  })

  it('en el último minuto avisa cuánto queda y qué hacer', () => {
    expect(takeLimitNotice({ stop: false, secondsLeft: 45 })).toBe(
      'Quedan 45 segundos de grabación en esta toma. Cuando se corte, lo dictado se transcribe y podés seguir con otra toma.',
    )
  })

  it('al cortar dice que no se perdió nada y cómo seguir', () => {
    expect(takeLimitNotice({ stop: true, secondsLeft: 0 })).toBe(
      'Esta toma llegó al tope de grabación de este equipo y se detuvo sola. Lo dictado se transcribe y la grabación se guarda. Para seguir, grabá otra toma.',
    )
  })
})
