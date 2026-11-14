import { describe, expect, it } from 'vitest'
import { labNamesFromEvolution, retireErrorMessage, storedBloodPressureText } from '../voided-origin'

/** D24, 4 bis — lo que la pantalla de la corrección necesita saber y decir. */
const VOIDED = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

describe('labNamesFromEvolution', () => {
  it('los laboratorios del perfil que vinieron de esa evolución, en las dos formas del origen, sin repetir', () => {
    const labs = [
      { name: 'Ferritina', value: 480, source: { kind: 'evolution' as const, evolutionId: VOIDED } },
      { name: 'TSH', value: 2, sourceEvolutionId: VOIDED },
      { name: 'Glucosa', value: 110, source: { kind: 'evolution' as const, evolutionId: OTHER } },
      { name: 'HbA1c', value: 7.9 },
    ]
    expect(labNamesFromEvolution(labs, VOIDED)).toEqual(['Ferritina', 'TSH'])
    expect(labNamesFromEvolution(labs, '33333333-3333-4333-8333-333333333333')).toEqual([])
  })
})

describe('retireErrorMessage — ningún rechazo se traga en silencio', () => {
  it('el perfil cambió mientras la persona elegía: lo dice y pide volver a elegir', () => {
    for (const code of ['not_in_profile', 'not_empty']) {
      const text = retireErrorMessage(409, code)
      expect(text).toContain('El perfil cambió')
      expect(text).toContain('No se retiró nada')
    }
  })

  it('sin elegir nada y sin declararlo', () => {
    expect(retireErrorMessage(400, 'selection_required')).toContain('Elegí qué sale')
  })

  it('el sujeto no coincide', () => {
    expect(retireErrorMessage(409, 'subject_mismatch')).toContain('no coincide')
  })

  it('la evolución ya no figura como anulada o no es de este sujeto', () => {
    expect(retireErrorMessage(409, 'evolution_not_voided')).toContain('no figura como registrada por error')
    expect(retireErrorMessage(404, 'request_failed')).toContain('no figura como registrada por error')
  })

  it('sin la capacidad de escribir el perfil: dice quién puede y no promete nada', () => {
    const text = retireErrorMessage(403, 'request_failed')
    expect(text).toContain('quien puede escribir evoluciones')
    expect(text).toContain('No se retiró nada')
  })

  it('demasiados pedidos', () => {
    expect(retireErrorMessage(429, 'request_failed')).toContain('Esperá')
  })

  it('el perfil guardado no se pudo leer usa el mensaje de siempre', () => {
    expect(retireErrorMessage(422, 'profile_unreadable')).toContain('no se pudo leer')
  })

  it('cualquier otra cosa: no se retiró nada', () => {
    expect(retireErrorMessage(500, 'request_failed')).toBe('No se pudo retirar. El perfil no cambió.')
  })
})

describe('storedBloodPressureText — la presión que se muestra es la que se retira', () => {
  it('con números guardados muestra los números, aunque la etiqueta diga otra cosa', () => {
    expect(storedBloodPressureText({ bloodPressureLabel: '130/85', systolic: 150, diastolic: 85 })).toBe('150/85')
  })

  it('con un solo número lo muestra y marca el que falta', () => {
    expect(storedBloodPressureText({ systolic: 150 })).toBe('150/—')
    expect(storedBloodPressureText({ diastolic: 85 })).toBe('—/85')
  })

  it('sin números usa la etiqueta; sin nada, no hay presión que ofrecer', () => {
    expect(storedBloodPressureText({ bloodPressureLabel: '130/85' })).toBe('130/85')
    expect(storedBloodPressureText({})).toBeUndefined()
    expect(storedBloodPressureText(undefined)).toBeUndefined()
  })
})
