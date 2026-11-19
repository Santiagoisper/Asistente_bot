import { describe, expect, it } from 'vitest'
import { uniqueConditions } from '../proposal-display'
import { measurementSection } from '../profile-sections'

describe('propuesta de perfil (recorrido 19/11, R-07)', () => {
  it('la misma condición escrita de dos formas aparece una vez, con la forma más larga', () => {
    expect(uniqueConditions(['DM2', 'diabetes tipo 2'])).toEqual(['diabetes tipo 2'])
    expect(uniqueConditions(['HTA', 'Hipertensión arterial', 'asma'])).toEqual(['Hipertensión arterial', 'asma'])
  })
  it('condiciones distintas no se juntan', () => {
    expect(uniqueConditions(['diabetes tipo 1', 'diabetes tipo 2'])).toHaveLength(2)
  })
  it('peso y talla van a antropometría, no a laboratorio', () => {
    expect(measurementSection('Peso')).toBe('antropometria')
    expect(measurementSection('Talla')).toBe('antropometria')
    expect(measurementSection('HbA1c')).toBe('laboratorio')
  })
})
