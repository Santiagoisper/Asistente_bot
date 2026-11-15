import { describe, expect, it } from 'vitest'
import { alignLabToBounds } from '../numeric-criteria'

/**
 * La unidad de un laboratorio frente a la del criterio (nota de Architect en el #161).
 * `mmol/mol` es la unidad IFCC de la HbA1c y se convierte a %. `mmol/L` es otra cosa
 * (glucosa, creatinina en otras tablas): antes cualquier unidad que contuviera «mmol» se
 * trataba como `mmol/mol`, y un «7,3 mmol/L» se habría convertido como si fuera HbA1c.
 */
describe('alignLabToBounds — mmol/mol no es mmol/L', () => {
  const percent = { unit: '%' as const, max: { value: 10, inclusive: true } }

  it('mmol/mol se convierte a % con la ecuación NGSP/IFCC', () => {
    const out = alignLabToBounds(53, 'mmol/mol', percent)
    expect(out).toMatchObject({ unit: '%' })
    expect((out as { value: number }).value).toBeCloseTo(7.0, 1)
  })

  it('escrito de otras formas sigue siendo mmol/mol', () => {
    for (const unit of ['MMOL/MOL', ' mmol / mol ', 'mmol/mol Hb', 'mmol/mol (IFCC)']) {
      expect(alignLabToBounds(53, unit, percent), unit).toMatchObject({ unit: '%' })
    }
  })

  it.each(['mmol/L', 'mmol/l', 'µmol/L', 'umol/L', 'mmol', 'mmol/24h'])('%s no se convierte: no se puede comparar con el criterio', (unit) => {
    const out = alignLabToBounds(7.3, unit, percent)
    expect(out).toEqual({ unknown: `unidad del laboratorio (${unit}) no se puede comparar con %.` })
  })

  it('un criterio en mmol/mol tampoco acepta mmol/L como si fuera lo mismo', () => {
    const out = alignLabToBounds(53, 'mmol/L', { unit: 'mmol/mol' as const, max: { value: 86, inclusive: true } })
    expect(out).toHaveProperty('unknown')
  })
})
