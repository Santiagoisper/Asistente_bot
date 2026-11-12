import { describe, expect, it } from 'vitest'

import { bloodPressureProposalLabel } from '../proposal-display'

describe('bloodPressureProposalLabel', () => {
  it('muestra las dos cifras cuando están las dos', () => {
    expect(bloodPressureProposalLabel({ systolic: 128, diastolic: 82 })).toBe('Presión arterial: 128/82')
  })

  it('muestra la sistólica sola y avisa que falta la diastólica', () => {
    expect(bloodPressureProposalLabel({ systolic: 128 })).toBe(
      'Presión arterial sistólica: 128 (no se leyó la diastólica)',
    )
  })

  it('muestra la diastólica sola y avisa que falta la sistólica', () => {
    expect(bloodPressureProposalLabel({ diastolic: 82 })).toBe(
      'Presión arterial diastólica: 82 (no se leyó la sistólica)',
    )
  })

  it('no muestra nada cuando no hay ninguna cifra', () => {
    expect(bloodPressureProposalLabel({})).toBeNull()
  })
})
