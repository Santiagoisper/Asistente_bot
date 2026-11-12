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

describe('assessScreening — criterios escritos como en un protocolo en castellano', () => {
  const base: PatientProfile = { version: 1, labs: [], medications: [], conditions: [] }
  const one = (profile: PatientProfile, text: string, kind: 'inclusion' | 'exclusion' = 'inclusion') =>
    assessScreening(profile, {
      inclusionCriteria: kind === 'inclusion' ? [{ number: '1', text }] : [],
      exclusionCriteria: kind === 'exclusion' ? [{ number: '1', text }] : [],
    })[0]!

  it('rango con la unidad entre los dos números: «entre 7,0 % y 10,5 %»', () => {
    const text = 'HbA1c entre 7,0 % y 10,5 % en la visita de seleccion.'
    expect(one({ ...base, labs: [{ name: 'Hemoglobina glicosilada (HbA1c)', value: 7.9, unit: '%' }] }, text).status).toBe('pass')
    expect(one({ ...base, labs: [{ name: 'HbA1c', value: 11.2, unit: '%' }] }, text).status).toBe('fail')
    expect(one(base, text).status).toBe('unknown')
  })

  it('edad: dentro del rango cumple, fuera no, y sin edad en el perfil faltan datos', () => {
    const text = 'Adultos de 18 a 75 anos de edad.'
    expect(one({ ...base, demographics: { ageYears: 58 } }, text)).toMatchObject({ status: 'pass' })
    expect(one({ ...base, demographics: { ageYears: 75 } }, text).status).toBe('pass')
    expect(one({ ...base, demographics: { ageYears: 80 } }, text).status).toBe('fail')
    expect(one(base, text)).toMatchObject({ status: 'unknown', reason: 'Edad no documentada en el perfil del sujeto.' })
    expect(one({ ...base, demographics: { ageYears: 17 } }, 'Edad mayor o igual a 18 años.').status).toBe('fail')
  })

  it('un plazo de tratamiento o un índice no se leen como edad', () => {
    const profile = { ...base, demographics: { ageYears: 58 } }
    expect(one(profile, 'Tratamiento estable con metformina durante al menos 90 dias.').reason).not.toContain('Edad')
    expect(one(profile, 'Indice de masa corporal entre 23 y 40 kg/m2.').reason).not.toContain('Edad')
    expect(one(profile, 'Diagnostico de diabetes tipo 2 de al menos 2 años de evolucion.').reason).not.toContain('Edad')
  })

  it('filtrado glomerular como criterio de exclusión: «menor de 45 mL/min»', () => {
    const text = 'Tasa de filtrado glomerular estimada menor de 45 mL/min/1,73 m2.'
    const withLab = (value: number) => ({ ...base, labs: [{ name: 'Filtrado glomerular estimado', value, unit: 'mL/min' }] })
    expect(one(withLab(72), text, 'exclusion').status).toBe('pass')
    expect(one(withLab(40), text, 'exclusion').status).toBe('fail')
    expect(one(base, text, 'exclusion')).toMatchObject({ status: 'unknown' })
  })
})
