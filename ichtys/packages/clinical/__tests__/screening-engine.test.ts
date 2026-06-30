import { describe, expect, it } from 'vitest'
import { assessScreening, screeningSummary } from '../screening-engine'
import type { PatientProfile } from '../profile-schema'

const profileWithHba1c: PatientProfile = {
  version: 1,
  labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
  medications: [{ name: 'Metformina', dose: '850 mg' }],
  conditions: [],
}

describe('assessScreening', () => {
  it('pasa HbA1c dentro de rango 7-10', () => {
    const results = assessScreening(profileWithHba1c, {
      inclusionCriteria: [
        {
          number: '1',
          text: 'HbA1c ≥ 7,0% y < 10,0% en screening.',
        },
      ],
      exclusionCriteria: [],
    })
    expect(results[0]?.status).toBe('pass')
  })

  it('marca unknown si falta HbA1c en perfil', () => {
    const results = assessScreening(
      { version: 1, labs: [], medications: [], conditions: [] },
      {
        inclusionCriteria: [{ number: '1', text: 'HbA1c ≥ 7,0% y < 10,0%.' }],
        exclusionCriteria: [],
      },
    )
    expect(results[0]?.status).toBe('unknown')
  })

  it('resume conteos', () => {
    const summary = screeningSummary([
      { criterionNumber: '1', criterionText: 'a', kind: 'inclusion', status: 'pass', reason: '' },
      { criterionNumber: '2', criterionText: 'b', kind: 'inclusion', status: 'unknown', reason: '' },
    ])
    expect(summary.pass).toBe(1)
    expect(summary.unknown).toBe(1)
  })
})
