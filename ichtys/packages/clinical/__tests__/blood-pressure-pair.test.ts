import { describe, expect, it } from 'vitest'
import { mergedBloodPressure } from '../blood-pressure'
import { mergeProfileWithFacts } from '../extract-facts'
import { mergeProfileWithExtraction } from '../extract-merge'
import { parsePatientProfile } from '../profile-schema'

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

describe('los dos caminos que suman una evolución al perfil usan la regla del par', () => {
  const EVO = '11111111-1111-4111-8111-111111111111'
  const profile = () =>
    parsePatientProfile({ version: 1, vitals: { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' }, labs: [], medications: [], conditions: [] })
  const facts = (over: { systolic?: number; diastolic?: number }) => ({ labs: [], medications: [], conditions: [], ...over })

  it('aceptar una propuesta con solo la sistólica no mezcla el par', () => {
    const out = mergeProfileWithExtraction(profile(), { facts: facts({ systolic: 132 }), fieldConfidence: {} }, EVO)
    expect(out.vitals).toEqual({ systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' })
  })

  it('el camino por reglas, con solo la diastólica, tampoco', () => {
    const out = mergeProfileWithFacts(profile(), facts({ diastolic: 70 }), EVO)
    expect(out.vitals).toEqual({ systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' })
  })

  it('con el par completo, los dos lo reemplazan', () => {
    expect(mergeProfileWithExtraction(profile(), { facts: facts({ systolic: 132, diastolic: 84 }), fieldConfidence: {} }, EVO).vitals).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
    expect(mergeProfileWithFacts(profile(), facts({ systolic: 132, diastolic: 84 }), EVO).vitals).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
  })
})

/**
 * La marca de confianza de la presión acompaña al par que entra de verdad. Al
 * confirmar una propuesta, el servicio pasa la marca que quedó guardada junto
 * con ella (patient-profile-service): si su medio par no entra, esa marca no
 * puede quedarse aplicada a la presión anterior que sigue guardada.
 */
describe('la marca de confianza de la presión solo cambia si entró el par nuevo', () => {
  const EVO = '11111111-1111-4111-8111-111111111111'
  const profile = () =>
    parsePatientProfile({
      version: 1,
      vitals: { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' },
      fieldConfidence: { bloodPressure: 'high' },
      labs: [],
      medications: [],
      conditions: [],
    })
  const facts = (over: { systolic?: number; diastolic?: number }) => ({ labs: [], medications: [], conditions: [], ...over })

  it('una propuesta con solo la sistólica no cambia la marca de la presión guardada', () => {
    const out = mergeProfileWithExtraction(
      profile(),
      { facts: facts({ systolic: 132 }), fieldConfidence: { bloodPressure: 'medium' } },
      EVO,
    )
    expect(out.vitals).toEqual({ systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' })
    expect(out.fieldConfidence?.bloodPressure).toBe('high')
  })

  it('una propuesta con solo la diastólica tampoco', () => {
    const out = mergeProfileWithExtraction(
      profile(),
      { facts: facts({ diastolic: 70 }), fieldConfidence: { bloodPressure: 'low' } },
      EVO,
    )
    expect(out.vitals).toEqual({ systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' })
    expect(out.fieldConfidence?.bloodPressure).toBe('high')
  })

  it('sin presión nueva en la extracción, la marca guardada sigue', () => {
    const out = mergeProfileWithExtraction(
      profile(),
      { facts: facts({}), fieldConfidence: { bloodPressure: 'medium' } },
      EVO,
    )
    expect(out.vitals).toEqual({ systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' })
    expect(out.fieldConfidence?.bloodPressure).toBe('high')
  })

  it('con el par completo, la marca nueva sí se aplica', () => {
    const out = mergeProfileWithExtraction(
      profile(),
      { facts: facts({ systolic: 132, diastolic: 84 }), fieldConfidence: { bloodPressure: 'medium' } },
      EVO,
    )
    expect(out.vitals).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
    expect(out.fieldConfidence?.bloodPressure).toBe('medium')
  })

  it('con el par completo y sin marca nueva, queda la marca guardada', () => {
    const out = mergeProfileWithExtraction(profile(), { facts: facts({ systolic: 132, diastolic: 84 }), fieldConfidence: {} }, EVO)
    expect(out.vitals).toEqual({ systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' })
    expect(out.fieldConfidence?.bloodPressure).toBe('high')
  })
})
