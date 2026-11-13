/**
 * Las dos observaciones que Reviewer dejó sin bloquear en el #136, y una tercera del mismo
 * borde que apareció al escribir sus pruebas (antecedentes familiares).
 */
import { describe, expect, it } from 'vitest'
import { emptyPatientProfile, type PatientProfile } from '../profile-schema'
import { assessScreening } from '../screening-engine'

const profileWith = (conditions: string[]): PatientProfile => ({ version: 1, labs: [], medications: [], conditions })
const exclusion = (profile: PatientProfile, text: string) => assessScreening(profile, { inclusionCriteria: [], exclusionCriteria: [{ number: '1', text }] })[0]!

describe('una negación con «de» adentro tampoco afirma', () => {
  it.each([
    // No tener pancreatitis a repetición no dice si alguna vez tuvo una.
    'Sin pancreatitis de repetición',
    // Lo que se niega es la historia de la familia, no la del sujeto.
    'Sin antecedentes familiares de pancreatitis',
    'Niega antecedentes familiares de pancreatitis',
  ])('queda a revisar y el motivo cita la frase: %s', (condition) => {
    const result = exclusion(profileWith([condition]), 'Antecedente de pancreatitis.')
    expect(result.status).toBe('unknown')
    expect(result.reason).not.toMatch(/Registrado en el perfil/)
    expect(result.reason).toContain(`«${condition}»`)
  })

  it.each(['Sin dolor por pancreatitis previa', 'Sin control de la pancreatitis crónica', 'Sin signos de pancreatitis, internada en 2019', 'Sin controles desde la pancreatitis'])(
    'una frase que dice algo más sigue activando: %s',
    (condition) => {
      expect(exclusion(profileWith([condition]), 'Antecedente de pancreatitis.').status).toBe('fail')
    },
  )
})

describe('el motivo le dice al médico la frase que de verdad despeja', () => {
  it('para un antecedente sugiere negar el antecedente', () => {
    expect(exclusion(emptyPatientProfile(), 'Antecedente de pancreatitis.').reason).toContain('«sin antecedentes de pancreatitis»')
  })

  it('para un estado sugiere negar el estado, en una sola frase', () => {
    expect(exclusion(emptyPatientProfile(), 'Embarazo o lactancia.').reason).toContain('«sin embarazo ni lactancia»')
    expect(exclusion(profileWith(['Sin embarazo']), 'Embarazo o lactancia.').reason).toContain('«sin lactancia»')
  })

  it('la frase sugerida, dicha tal cual, despeja el criterio', () => {
    for (const [criterion, phrase] of [
      ['Antecedente de pancreatitis.', 'Sin antecedentes de pancreatitis'],
      ['Embarazo o lactancia.', 'Sin embarazo ni lactancia'],
    ] as const) {
      expect(exclusion(emptyPatientProfile(), criterion).reason.toLowerCase()).toContain(phrase.toLowerCase())
      expect(exclusion(profileWith([phrase]), criterion).status).toBe('pass')
    }
  })
})
