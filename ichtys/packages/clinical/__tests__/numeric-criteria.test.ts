import { describe, expect, it } from 'vitest'
import { assessScreening } from '../screening-engine'
import {
  ifccMmolToNgsp,
  normalizeDecimalCommas,
  parseAnalyteBounds,
} from '../numeric-criteria'
import type { PatientProfile } from '../profile-schema'

function profile(labs: PatientProfile['labs']): PatientProfile {
  return { version: 1, labs, medications: [], conditions: [] }
}

describe('ADR-7 §2.1 umbrales de HbA1c', () => {
  it('T1: 10,2 % entra en ≥7,0 y ≤10,5', () => {
    const [result] = assessScreening(profile([{ name: 'HbA1c', value: 10.2, unit: '%' }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≥7,0 % y ≤10,5 %' }],
      exclusionCriteria: [],
    })
    expect(result?.status).toBe('pass')
    // Un rango cumplido se comparó contra los dos extremos: el motivo cita los dos.
    expect(result?.reason).toBe('HbA1c 10,2 % ≥ 7,0 % (mínimo inclusivo) y ≤ 10,5 % (máximo inclusivo)')
  })

  it('T1b: el motivo de un rango cumplido cita los dos extremos, con el operador de cada uno', () => {
    const lab = profile([{ name: 'HbA1c', value: 7.9, unit: '%' }])
    const [strictLow] = assessScreening(lab, { inclusionCriteria: [{ number: '1', text: 'HbA1c > 7,0 % y ≤ 10,5 %' }], exclusionCriteria: [] })
    expect(strictLow?.status).toBe('pass')
    expect(strictLow?.reason).toBe('HbA1c 7,9 % > 7,0 % (mínimo estricto) y ≤ 10,5 % (máximo inclusivo)')
    // En una exclusión, lo mismo: lo que la activa es estar adentro del rango entero.
    const [excluded] = assessScreening(lab, { inclusionCriteria: [], exclusionCriteria: [{ number: '2', text: 'HbA1c ≥ 7,5 % y ≤ 9,0 %' }] })
    expect(excluded?.status).toBe('fail')
    expect(excluded?.reason).toBe('HbA1c 7,9 % ≥ 7,5 % (mínimo inclusivo) y ≤ 9,0 % (máximo inclusivo): activaría este criterio de exclusión.')
  })

  it('T1c: un rango que no se cumple sigue citando solo el extremo que falla', () => {
    const [low] = assessScreening(profile([{ name: 'HbA1c', value: 6.4, unit: '%' }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≥7,0 % y ≤10,5 %' }],
      exclusionCriteria: [],
    })
    expect(low?.status).toBe('fail')
    expect(low?.reason).toBe('HbA1c 6,4 % ≥ 7,0 % (mínimo inclusivo) no se cumple')
  })

  it('T2: 7,0 % no cumple un mínimo estricto > 7,0', () => {
    const [result] = assessScreening(profile([{ name: 'HbA1c', value: 7, unit: '%' }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c > 7,0 %' }],
      exclusionCriteria: [],
    })
    expect(result?.status).toBe('fail')
    expect(result?.reason).toContain('> 7,0 % (mínimo estricto)')
    expect(result?.reason).toContain('no se cumple')
  })

  it('T3: el operador de cada cota decide, no el texto completo', () => {
    const lab = profile([{ name: 'A1c', value: 10.5, unit: '%' }])
    const strict = assessScreening(lab, {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≥ 7,0 % y < 10,5 %' }],
      exclusionCriteria: [],
    })
    const inclusive = assessScreening(lab, {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≤ 10,5' }],
      exclusionCriteria: [],
    })
    expect(strict[0]?.status).toBe('fail')
    expect(strict[0]?.reason).toContain('< 10,5 % (máximo estricto)')
    expect(inclusive[0]?.status).toBe('pass')
    expect(inclusive[0]?.reason).toContain('≤ 10,5 % (máximo inclusivo)')
  })

  it('T4: 53 mmol/mol (≈ 7,0 %) no activa exclusión > 10 %', () => {
    const [result] = assessScreening(
      profile([{ name: 'hemoglobina glicosilada', value: 53, unit: 'mmol/mol' }]),
      {
        inclusionCriteria: [],
        exclusionCriteria: [{ number: 'E1', text: 'HbA1c > 10 %' }],
      },
    )
    expect(result?.status).toBe('pass')
    expect(result?.reason).toContain('7,0 %')
    expect(result?.reason).toContain('> 10,0 %')
    expect(result?.reason).toContain('no activa')
  })

  it('T5: "entre A y B" se asume inclusivo y queda el aviso', () => {
    const [result] = assessScreening(profile([{ name: 'glycated hemoglobin', value: 8, unit: '%' }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c entre 7,0 y 10,5 %' }],
      exclusionCriteria: [],
    })
    expect(result?.status).toBe('pass')
    expect(result?.reason).toContain('rango sin operador: se asumió inclusivo')
    expect(parseAnalyteBounds('HbA1c entre 7,0 y 10,5 %', 'HbA1c')?.warning).toBe(
      'rango sin operador: se asumió inclusivo',
    )
  })

  it('T6: el separador de miles 1,000 no se lee como 1.0', () => {
    const text = 'metformina ≥ 1,000 mg'
    expect(normalizeDecimalCommas(text)).toBe(text)
    expect(normalizeDecimalCommas(text)).not.toContain('1.0')
    expect(normalizeDecimalCommas('HbA1c ≥7,0 % y ≤10,5 %')).toBe('HbA1c ≥7.0 % y ≤10.5 %')
    expect(parseAnalyteBounds('HbA1c ≥ 1,000 mmol/mol', 'HbA1c')?.min).toEqual({
      value: 1000,
      inclusive: true,
    })
  })

  it('tabla NGSP/IFCC: 48 ≈ 6,5 %, 53 ≈ 7,0 %, 64 ≈ 8,0 %', () => {
    expect(ifccMmolToNgsp(48)).toBeCloseTo(6.5, 1)
    expect(ifccMmolToNgsp(53)).toBeCloseTo(7.0, 1)
    expect(ifccMmolToNgsp(64)).toBeCloseTo(8.0, 1)
  })

  it('sin unidad fuera de 3–20 queda unknown', () => {
    const [result] = assessScreening(profile([{ name: 'HbA1c', value: 53 }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≤ 10,5 %' }],
      exclusionCriteria: [],
    })
    expect(result?.status).toBe('unknown')
    expect(result?.reason).toContain('sin unidad')
  })

  it('un valor por debajo del mínimo cita esa cota, aunque exista un máximo', () => {
    const [result] = assessScreening(profile([{ name: 'HbA1c', value: 6.4, unit: '%' }]), {
      inclusionCriteria: [{ number: '1', text: 'HbA1c ≥7,0 % y ≤10,5 %' }],
      exclusionCriteria: [],
    })
    expect(result?.status).toBe('fail')
    expect(result?.reason).toContain('≥ 7,0 % (mínimo inclusivo)')
    expect(result?.reason).not.toContain('máximo')
  })
})
