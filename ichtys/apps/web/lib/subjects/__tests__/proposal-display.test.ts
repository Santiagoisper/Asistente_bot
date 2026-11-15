import { describe, expect, it } from 'vitest'

import { mergeProfileWithExtraction, parsePatientProfile } from '@ichtys/clinical'

import { bloodPressureProposalLabel } from '../proposal-display'

describe('bloodPressureProposalLabel', () => {
  it('muestra las dos cifras cuando están las dos', () => {
    expect(bloodPressureProposalLabel({ systolic: 128, diastolic: 82 })).toBe('Presión arterial: 128/82')
  })

  it('muestra la sistólica sola, avisa que falta la diastólica y dice que al aceptar no se guarda', () => {
    expect(bloodPressureProposalLabel({ systolic: 128 })).toBe(
      'Presión arterial sistólica: 128. No se leyó la diastólica: al aceptar, la presión no se guarda',
    )
  })

  it('muestra la diastólica sola, avisa que falta la sistólica y dice que al aceptar no se guarda', () => {
    expect(bloodPressureProposalLabel({ diastolic: 82 })).toBe(
      'Presión arterial diastólica: 82. No se leyó la sistólica: al aceptar, la presión no se guarda',
    )
  })

  it('no muestra nada cuando no hay ninguna cifra', () => {
    expect(bloodPressureProposalLabel({})).toBeNull()
  })
})

/**
 * Pedido de Architect en el #193: desde que la presión entra al perfil solo como par completo,
 * la propuesta no puede mostrar una cifra sola sin decir que aceptar no la guarda. Lo que la
 * pantalla dice y lo que aceptar hace se comparan acá, caso por caso.
 */
describe('lo que la propuesta dice de la presión coincide con lo que aceptar guarda', () => {
  const EVO = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const STORED = { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' }
  const accept = (bp: { systolic?: number; diastolic?: number }) =>
    mergeProfileWithExtraction(
      parsePatientProfile({ version: 1, vitals: STORED, labs: [], medications: [], conditions: [] }),
      { facts: { labs: [], medications: [], conditions: [], ...bp }, fieldConfidence: {} },
      EVO,
    ).vitals

  it.each([
    { name: 'el par completo', bp: { systolic: 128, diastolic: 82 }, saved: true },
    { name: 'solo la sistólica', bp: { systolic: 128 }, saved: false },
    { name: 'solo la diastólica', bp: { diastolic: 82 }, saved: false },
  ])('$name: guarda = $saved, y el texto lo dice', ({ bp, saved }) => {
    const label = bloodPressureProposalLabel(bp)
    const stored = accept(bp)

    expect(label).not.toBeNull()
    expect(String(label).includes('al aceptar, la presión no se guarda')).toBe(!saved)
    if (saved) expect(stored).toEqual({ systolic: 128, diastolic: 82, bloodPressureLabel: '128/82' })
    else expect(stored).toEqual(STORED)
  })
})
