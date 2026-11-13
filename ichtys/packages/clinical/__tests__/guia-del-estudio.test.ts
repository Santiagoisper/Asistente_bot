/**
 * La guía según el protocolo (D18): qué más decir en este estudio para este sujeto.
 * Sale de los criterios que quedaron a revisar por un dato que falta, y solo pide lo que
 * el sistema sabe leer. Estas pruebas dictan cada frase de la guía y comprueban que el
 * dato llega al criterio: si la guía enseña una frase que la extracción no lee, fallan.
 */
import { describe, expect, it } from 'vitest'
import { studyDictationPrompts } from '../dictation/study-prompts'
import { extractFactsFromEvolution, mergeProfileWithFacts } from '../extract-facts'
import { emptyPatientProfile, type PatientProfile } from '../profile-schema'
import { assessScreening } from '../screening-engine'

const PROTOCOL = {
  inclusionCriteria: [
    { number: '2.1', text: 'Adultos de 18 a 75 anos de edad.' },
    { number: '2.2', text: 'HbA1c entre 7,0 % y 10,5 % en la visita de seleccion.' },
    { number: '2.3', text: 'Indice de masa corporal entre 23 y 40 kg/m2.' },
    { number: '2.4', text: 'Tratamiento estable con metformina durante al menos 90 dias.' },
  ],
  exclusionCriteria: [
    { number: '3.1', text: 'Tasa de filtrado glomerular estimada menor de 45 mL/min/1,73 m2.' },
    { number: '3.2', text: 'ALT o AST mayor a 3 veces el limite superior normal.' },
    { number: '3.3', text: 'Antecedente de pancreatitis.' },
    { number: '3.4', text: 'Embarazo o lactancia.' },
  ],
}
const EVOLUTION = '00000000-0000-4000-8000-000000000001'
const afterSaying = (profile: PatientProfile, text: string) => mergeProfileWithFacts(profile, extractFactsFromEvolution(text), EVOLUTION)
const promptsFor = (profile: PatientProfile) => studyDictationPrompts(assessScreening(profile, PROTOCOL))

describe('la guía según el protocolo', () => {
  it('con el perfil vacío pide cada dato que falta, una vez, con el criterio que lo pide', () => {
    expect(promptsFor(emptyPatientProfile()).map((prompt) => [prompt.id, prompt.criteria])).toEqual([
      ['age', ['2.1']],
      ['hba1c', ['2.2']],
      ['weight-height', ['2.3']],
      ['egfr', ['3.1']],
      ['pancreatitis', ['3.3']],
      ['pregnancy-lactation', ['3.4']],
    ])
  })

  it('no pide lo que el sistema no sabe leer: el tiempo con metformina ni las transaminasas', () => {
    const criteria = promptsFor(emptyPatientProfile()).flatMap((prompt) => prompt.criteria)
    expect(criteria).not.toContain('2.4')
    expect(criteria).not.toContain('3.2')
  })

  it('el filtrado no se dicta: la guía dice que se resuelve con el laboratorio', () => {
    const egfr = promptsFor(emptyPatientProfile()).find((prompt) => prompt.id === 'egfr')!
    expect(egfr.say).toEqual([])
    expect(egfr.note).toMatch(/laboratorio/)
  })

  it('decir cada frase de la guía resuelve el dato: después solo falta el laboratorio', () => {
    const everything = promptsFor(emptyPatientProfile()).flatMap((prompt) => prompt.say).join(' ')
    const profile = afterSaying(emptyPatientProfile(), everything)
    expect(promptsFor(profile).map((prompt) => prompt.id)).toEqual(['egfr'])
    const byNumber = Object.fromEntries(assessScreening(profile, PROTOCOL).map((item) => [item.criterionNumber, item.status]))
    expect(byNumber).toMatchObject({ '2.1': 'pass', '2.2': 'pass', '2.3': 'pass', '3.3': 'pass', '3.4': 'pass' })
  })

  it('la guía también enseña a decir que SÍ: esa frase activa la exclusión', () => {
    for (const prompt of promptsFor(emptyPatientProfile()).filter((item) => item.sayIfPresent)) {
      const profile = afterSaying(emptyPatientProfile(), prompt.sayIfPresent!.join(' '))
      const statuses = assessScreening(profile, PROTOCOL).filter((item) => prompt.criteria.includes(item.criterionNumber))
      expect(statuses.map((item) => item.status), prompt.id).toEqual(['fail'])
    }
  })

  it('toda exclusión que se despeja diciendo «sin …» enseña también la frase contraria', () => {
    for (const prompt of promptsFor(emptyPatientProfile())) {
      if (prompt.say.some((phrase) => /^sin\b/i.test(phrase))) expect(prompt.sayIfPresent?.length, prompt.id).toBeGreaterThan(0)
    }
  })

  it('si falta una sola de las dos, pide esa', () => {
    const profile = afterSaying(emptyPatientProfile(), 'Sin embarazo.')
    const prompt = promptsFor(profile).find((item) => item.criteria.includes('3.4'))!
    expect(prompt.id).toBe('lactation')
    expect(prompt.say).toEqual(['Sin lactancia.'])
  })

  it('dos criterios que piden el mismo dato salen en un solo renglón', () => {
    const assessments = assessScreening(emptyPatientProfile(), {
      inclusionCriteria: [
        { number: '1', text: 'HbA1c mayor o igual a 7,0 %.' },
        { number: '2', text: 'HbA1c menor a 10,5 %.' },
      ],
      exclusionCriteria: [],
    })
    expect(studyDictationPrompts(assessments).map((prompt) => [prompt.id, prompt.criteria])).toEqual([['hba1c', ['1', '2']]])
  })

  it('un criterio resuelto, o a revisar por otra razón, no pide nada', () => {
    expect(studyDictationPrompts([{ criterionNumber: '9', status: 'pass' }, { criterionNumber: '10', status: 'unknown' }])).toEqual([])
  })
})
