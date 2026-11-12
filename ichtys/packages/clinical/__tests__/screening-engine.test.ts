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
          sourcePages: [42, 43],
        },
      ],
      exclusionCriteria: [],
    })
    expect(results[0]?.status).toBe('pass')
    expect(results[0]?.sourcePages).toEqual([42, 43])
  })

  it('excluye sujeto con antecedente de pancreatitis', () => {
    const results = assessScreening(
      {
        version: 1,
        labs: [{ name: 'HbA1c', value: 8.0, unit: '%' }],
        medications: [],
        conditions: ['Pancreatitis aguda previa'],
      },
      {
        inclusionCriteria: [],
        exclusionCriteria: [
          {
            number: '1',
            text: 'History of any pancreatitis (acute or chronic) at any time prior to enrollment.',
          },
        ],
      },
    )
    expect(results[0]?.status).toBe('fail')
  })

  describe('una exclusión no se despeja por falta de datos', () => {
    const exclusion = {
      inclusionCriteria: [],
      exclusionCriteria: [{ number: '1', text: 'Antecedente de pancreatitis aguda o crónica.' }],
    }
    const withConditions = (conditions: string[]): PatientProfile => ({ version: 1, labs: [], medications: [], conditions })

    it('perfil vacío: queda a revisar, no pasa', () => {
      const [result] = assessScreening(withConditions([]), exclusion)
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toMatch(/no prueba que no exista/)
    })

    it('otros antecedentes registrados tampoco la despejan', () => {
      expect(assessScreening(withConditions(['DM2', 'Hipertensión']), exclusion)[0]?.status).toBe('unknown')
    })

    it.each(['Sin antecedentes de pancreatitis', 'Niega pancreatitis', 'No refiere episodios de pancreatitis'])(
      'una negación registrada la despeja: %s',
      (condition) => {
        expect(assessScreening(withConditions([condition]), exclusion)[0]?.status).toBe('pass')
      },
    )

    it('una negación no tapa una mención afirmada', () => {
      const profile = withConditions(['Sin antecedentes de pancreatitis', 'Pancreatitis aguda en 2019'])
      expect(assessScreening(profile, exclusion)[0]?.status).toBe('fail')
    })

    it.each(['Sin fiebre. Pancreatitis crónica', 'Sin fiebre, con pancreatitis crónica', 'No tiene dolor pero tuvo pancreatitis'])(
      'la negación de otra cosa no niega la pancreatitis: %s',
      (condition) => {
        expect(assessScreening(withConditions([condition]), exclusion)[0]?.status).toBe('fail')
      },
    )

    it('medicación prohibida que no figura: queda a revisar, no pasa', () => {
      const [result] = assessScreening(withConditions([]), {
        inclusionCriteria: [],
        exclusionCriteria: [{ number: '2', text: 'Uso de metformina (prohibida durante el estudio).' }],
      })
      expect(result?.status).toBe('unknown')
    })
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
