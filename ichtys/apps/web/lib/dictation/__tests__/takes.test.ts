import { describe, expect, it } from 'vitest'
import { DICTATION_AUDIO_MAX_TAKES } from '../protocol'
import { addRecordingTake, audioLabel, groupAudiosByEvolution, missingTakes, missingTakesNotice, parseTake, takesNotice, uploadNotice, uploadRecordingTakes } from '../takes'

/** Varias grabaciones por evolución (docs/decisions/consulta-dictada.md, D22). */
describe('parseTake — el número de toma que llega en un pedido', () => {
  it('sin número es la primera toma (lo que mandaba el código anterior)', () => {
    expect(parseTake(null)).toBe(1)
    expect(parseTake(undefined)).toBe(1)
  })

  it('acepta de 1 al tope, y nada más', () => {
    for (let take = 1; take <= DICTATION_AUDIO_MAX_TAKES; take += 1) expect(parseTake(String(take))).toBe(take)
    for (const bad of ['0', String(DICTATION_AUDIO_MAX_TAKES + 1), '-1', '1.5', 'dos', '', ' 2', '2 ', '02', '1e0']) {
      expect(parseTake(bad), bad).toBeNull()
    }
  })
})

describe('addRecordingTake — lo que se va a subir al guardar', () => {
  const rec = (durationSec: number) => ({ blob: new Blob(['x']), durationSec })

  it('cada grabación lleva el número de la toma en que se dictó', () => {
    const one = addRecordingTake([], rec(10), 1)
    const two = addRecordingTake(one, rec(20), 2)
    expect(two.map((take) => [take.take, take.durationSec])).toEqual([
      [1, 10],
      [2, 20],
    ])
    expect(one).toHaveLength(1) // no se modifica la lista anterior
  })

  it('tres tomas y la segunda demasiado grande: quedan la 1 y la 3, con sus números (no «1 y 2»)', () => {
    let takes = addRecordingTake([], rec(10), 1)
    takes = addRecordingTake(takes, null, 2)
    takes = addRecordingTake(takes, rec(30), 3)
    expect(takes.map((take) => take.take)).toEqual([1, 3])
    expect(takes.map((take) => take.durationSec)).toEqual([10, 30])
  })

  it('pasado el tope de tomas no se suma, aunque haya menos grabaciones guardadas', () => {
    const takes = addRecordingTake([{ ...rec(10), take: 1 }], rec(99), DICTATION_AUDIO_MAX_TAKES + 1)
    expect(takes.map((take) => take.take)).toEqual([1])
  })

  it('la última toma dentro del tope sí se suma', () => {
    expect(addRecordingTake([], rec(5), DICTATION_AUDIO_MAX_TAKES).map((take) => take.take)).toEqual([DICTATION_AUDIO_MAX_TAKES])
  })
})

describe('missingTakes — las tomas de las que no hay grabación', () => {
  it('los huecos entre la primera y la última guardada', () => {
    expect(missingTakes([1, 3])).toEqual([2])
    expect(missingTakes([2, 5])).toEqual([1, 3, 4])
    expect(missingTakes([1, 2, 3])).toEqual([])
    expect(missingTakes([1])).toEqual([])
    expect(missingTakes([])).toEqual([])
  })

  it('el aviso las nombra; sin huecos no hay aviso', () => {
    expect(missingTakesNotice([])).toBeNull()
    expect(missingTakesNotice([2])).toBe('De la toma 2 no hay grabación guardada: quedó solo el texto.')
    expect(missingTakesNotice([2, 4])).toBe('De las tomas 2 y 4 no hay grabación guardada: quedó solo el texto.')
    expect(missingTakesNotice([1, 3, 4])).toBe('De las tomas 1, 3 y 4 no hay grabación guardada: quedó solo el texto.')
  })
})

describe('audioLabel — cómo se nombra cada grabación junto a la evolución', () => {
  it('una sola grabación, la de la primera toma: sin número', () => {
    expect(audioLabel({ take: 1, several: false })).toBe('Dictada')
  })

  it('con varias, o si la única no es la primera, dice qué toma es', () => {
    expect(audioLabel({ take: 1, several: true })).toBe('Dictada · toma 1')
    expect(audioLabel({ take: 3, several: true })).toBe('Dictada · toma 3')
    expect(audioLabel({ take: 3, several: false })).toBe('Dictada · toma 3')
  })
})

describe('takesNotice — lo que lee quien dicta dice lo que hace el sistema', () => {
  it('primera toma: se guarda al guardar la evolución, todavía nada', () => {
    expect(takesNotice({ takes: 1, tooLarge: false, retentionDays: 30 })).toBe(
      'Al guardar la evolución, la grabación queda guardada 30 días. Todavía no se guardó nada.',
    )
  })

  it('primera toma demasiado grande: queda solo el texto', () => {
    expect(takesNotice({ takes: 1, tooLarge: true, retentionDays: 30 })).toBe(
      'Esta grabación es demasiado grande para guardarse junto a la evolución: va a quedar solo el texto.',
    )
  })

  it('una toma más, dentro del tope: se guardan todas', () => {
    expect(takesNotice({ takes: 3, tooLarge: false, retentionDays: 30 })).toBe(
      'Se sumó a lo que ya estaba. Al guardar la evolución quedan guardadas las grabaciones de cada toma, 30 días. Todavía no se guardó nada.',
    )
  })

  it('una toma más, demasiado grande: esa queda solo como texto', () => {
    expect(takesNotice({ takes: 2, tooLarge: true, retentionDays: 30 })).toBe(
      'Se sumó a lo que ya estaba. Esta grabación es demasiado grande para guardarse: de esta toma queda solo el texto.',
    )
  })

  it('pasado el tope: lo dice con el número', () => {
    expect(takesNotice({ takes: DICTATION_AUDIO_MAX_TAKES + 1, tooLarge: false, retentionDays: 30 })).toBe(
      `Se sumó a lo que ya estaba. Se guardan las grabaciones de las primeras ${DICTATION_AUDIO_MAX_TAKES} tomas; lo dictado después queda como texto.`,
    )
  })
})

describe('groupAudiosByEvolution — el listado, por evolución y en orden de toma', () => {
  it('agrupa y ordena', () => {
    const audio = (evolutionId: string, take: number) => ({ evolutionId, take, durationSec: take * 10, expiresAt: '2026-12-14T00:00:00.000Z', available: true })
    const grouped = groupAudiosByEvolution([audio('e1', 2), audio('e2', 1), audio('e1', 1)])
    expect(Object.keys(grouped).sort()).toEqual(['e1', 'e2'])
    expect(grouped.e1!.map((item) => item.take)).toEqual([1, 2])
    expect(grouped.e2!.map((item) => item.take)).toEqual([1])
  })

  it('una fila sin número de toma (respuesta de una versión anterior) vale como la primera', () => {
    const grouped = groupAudiosByEvolution([{ evolutionId: 'e1', durationSec: 5, expiresAt: '2026-12-14T00:00:00.000Z', available: true }])
    expect(grouped.e1![0]!.take).toBe(1)
  })
})

describe('uploadRecordingTakes — subir cada toma después de guardar la evolución', () => {
  const take = (durationSec: number, type = 'audio/webm', number = durationSec) => ({ blob: new Blob(['x'], { type }), durationSec, take: number })
  const ok = () => new Response('{}', { status: 201 })

  it('una subida por grabación, en orden, cada una con el número de su toma (con hueco si una no se grabó), su tipo y su duración', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const result = await uploadRecordingTakes({
      url: '/api/x/audio',
      takes: [take(10, 'audio/webm', 1), take(20, '', 3)],
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), headers: init?.headers as Record<string, string> })
        return ok()
      },
    })
    expect(result).toEqual({ total: 2, failed: 0 })
    expect(calls).toEqual([
      { url: '/api/x/audio', headers: { 'Content-Type': 'audio/webm', 'X-Duration-Sec': '10', 'X-Take': '1' } },
      { url: '/api/x/audio', headers: { 'Content-Type': 'audio/webm', 'X-Duration-Sec': '20', 'X-Take': '3' } },
    ])
  })

  it('una toma que falla no frena a las siguientes, y se cuenta', async () => {
    let call = 0
    const result = await uploadRecordingTakes({
      url: '/api/x/audio',
      takes: [take(1), take(2), take(3)],
      fetchImpl: async () => {
        call += 1
        if (call === 1) throw new Error('red caída')
        return call === 2 ? new Response('{}', { status: 500 }) : ok()
      },
    })
    expect(call).toBe(3)
    expect(result).toEqual({ total: 3, failed: 2 })
  })

  it('una toma que ya estaba guardada (409, por un reintento) no es una falla', async () => {
    const result = await uploadRecordingTakes({ url: '/u', takes: [take(1)], fetchImpl: async () => new Response('{}', { status: 409 }) })
    expect(result).toEqual({ total: 1, failed: 0 })
  })

  it('sin tomas no pide nada', async () => {
    let called = false
    const result = await uploadRecordingTakes({ url: '/u', takes: [], fetchImpl: async () => ((called = true), ok()) })
    expect(called).toBe(false)
    expect(result).toEqual({ total: 0, failed: 0 })
  })
})

describe('uploadNotice — qué se le dice a la persona si alguna grabación no se guardó', () => {
  it('todo guardado: nada que avisar', () => {
    expect(uploadNotice({ total: 3, failed: 0 })).toBeNull()
    expect(uploadNotice({ total: 0, failed: 0 })).toBeNull()
  })

  it('la única grabación falló', () => {
    expect(uploadNotice({ total: 1, failed: 1 })).toBe('La evolución se guardó. La grabación no se pudo guardar; el texto quedó completo.')
  })

  it('fallaron algunas: dice cuántas de cuántas', () => {
    expect(uploadNotice({ total: 3, failed: 2 })).toBe('La evolución se guardó. 2 de las 3 grabaciones no se pudieron guardar; el texto quedó completo.')
    expect(uploadNotice({ total: 3, failed: 1 })).toBe('La evolución se guardó. 1 de las 3 grabaciones no se pudo guardar; el texto quedó completo.')
  })
})
