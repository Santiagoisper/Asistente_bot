import { describe, expect, it } from 'vitest'
import { mergedBloodPressure } from '../blood-pressure'

/**
 * La presión arterial es un par. Antes cada número se tomaba por separado: una evolución que
 * traía solo la sistólica dejaba en el perfil esa sistólica con la diastólica de otra evolución,
 * y la etiqueta seguía mostrando el par viejo (Architect, #175). Ese par nadie lo midió.
 */
describe('mergedBloodPressure', () => {
  const previous = { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' }

  it('un par nuevo completo reemplaza al anterior, con su etiqueta', () => {
    expect(mergedBloodPressure(previous, { systolic: 132, diastolic: 84 })).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
  })

  it('solo la sistólica: no se arma un par con la diastólica de otra evolución; queda el par anterior entero', () => {
    expect(mergedBloodPressure(previous, { systolic: 132 })).toEqual(previous)
  })

  it('solo la diastólica: lo mismo', () => {
    expect(mergedBloodPressure(previous, { diastolic: 84 })).toEqual(previous)
  })

  it('sin presión nueva queda la anterior', () => {
    expect(mergedBloodPressure(previous, {})).toEqual(previous)
  })

  it('sin presión anterior y con medio par nuevo, no queda nada: medio par no es una presión', () => {
    expect(mergedBloodPressure(undefined, { systolic: 132 })).toEqual({ systolic: undefined, diastolic: undefined, bloodPressureLabel: undefined })
  })

  it('sin presión anterior y con par completo, queda el nuevo', () => {
    expect(mergedBloodPressure(undefined, { systolic: 120, diastolic: 80 })).toEqual({ systolic: 120, diastolic: 80, bloodPressureLabel: '120/80' })
  })

  it('la etiqueta guardada sale de los números guardados: una etiqueta vieja que no coincide se corrige', () => {
    expect(mergedBloodPressure({ systolic: 132, diastolic: 84, bloodPressureLabel: '150/95' }, {})).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
  })

  it('un perfil anterior que ya tenía medio par (guardado antes de esta regla) se conserva tal cual: no se inventa ni se borra', () => {
    const half = { systolic: 140, diastolic: undefined, bloodPressureLabel: '140/90' }
    expect(mergedBloodPressure(half, {})).toEqual(half)
  })
})
