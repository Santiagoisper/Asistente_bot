import { describe, expect, it } from 'vitest'

import { bloodPressureProposalLabel } from '../proposal-display'

describe('bloodPressureProposalLabel', () => {
  it('muestra las dos cifras cuando están las dos', () => {
    expect(bloodPressureProposalLabel({ systolic: 128, diastolic: 82 })).toBe('Presión arterial: 128/82')
  })

  it('muestra la sistólica sola y avisa que falta la diastólica y que una cifra sola no se guarda', () => {
    expect(bloodPressureProposalLabel({ systolic: 128 })).toBe(
      'Presión arterial sistólica: 128 (no se leyó la diastólica; sin las dos cifras no se guarda)',
    )
  })

  it('muestra la diastólica sola y avisa que falta la sistólica y que una cifra sola no se guarda', () => {
    expect(bloodPressureProposalLabel({ diastolic: 82 })).toBe(
      'Presión arterial diastólica: 82 (no se leyó la sistólica; sin las dos cifras no se guarda)',
    )
  })

  it('no muestra nada cuando no hay ninguna cifra', () => {
    expect(bloodPressureProposalLabel({})).toBeNull()
  })
})
