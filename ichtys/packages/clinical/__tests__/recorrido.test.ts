/**
 * Recorrido de punta a punta, en la capa de dominio y sin modelos: lo dictado en una
 * visita llega a la elegibilidad pasando por cada eslabón determinista.
 *
 *   transcripción → borrador por bloques (con correcciones dictadas) → hechos propuestos
 *   → perfil del sujeto → elegibilidad → laboratorio confirmado → elegibilidad
 *
 * Lo que este recorrido NO cubre: la transcripción del audio (corre en el navegador), la
 * lectura con modelo de la evolución y del informe de laboratorio, la revisión de la
 * persona entre cada paso y el guardado. Todos los datos son inventados.
 */
import { describe, expect, it } from 'vitest'

import { buildDictationDraft } from '../dictation'
import { extractFactsFromEvolution, mergeProfileWithFacts } from '../extract-facts'
import { mergeConfirmedLabs } from '../lab-ocr-parser'
import { emptyPatientProfile, type PatientProfile } from '../profile-schema'
import { assessScreening, screeningSummary, type ScreeningInput } from '../screening-engine'

const PROTOCOL: ScreeningInput = {
  inclusionCriteria: [
    { number: 'I1', text: 'Pacientes de 18 a 75 años.' },
    { number: 'I2', text: 'HbA1c entre 7,0 % y 10,5 % en la visita de selección.' },
    { number: 'I3', text: 'Tratamiento estable con metformina durante al menos 3 meses.' },
    { number: 'I4', text: 'Firma del consentimiento informado.' },
  ],
  exclusionCriteria: [
    { number: 'E1', text: 'Filtrado glomerular estimado < 45 mL/min/1,73 m².' },
    { number: 'E2', text: 'Antecedente de pancreatitis.' },
    { number: 'E3', text: 'Tratamiento con insulina en los últimos 3 meses.' },
    { number: 'E4', text: 'Embarazo o lactancia.' },
  ],
}

const DICTATED =
  'Visita de selección. Paciente de 58 años. Motivo: control clínico inicial. ' +
  'Medicación actual: metformina 850 mg cada 12 h. ' +
  'Signos vitales: presión arterial 140 sobre 90. Corrijo, 132 sobre 84. Frecuencia cardíaca 72. ' +
  'Eventos adversos: ninguno. Plan: solicitar laboratorio y citar en dos semanas.'

const byNumber = (profile: PatientProfile) =>
  Object.fromEntries(assessScreening(profile, PROTOCOL).map((a) => [a.criterionNumber, a.status]))

const resolved = (profile: PatientProfile) => {
  const summary = screeningSummary(assessScreening(profile, PROTOCOL))
  return summary.pass + summary.fail
}

describe('recorrido: de la visita dictada a la elegibilidad', () => {
  const draft = buildDictationDraft(DICTATED)
  const facts = extractFactsFromEvolution(draft.text, 'evo-1')
  const empty = emptyPatientProfile()
  const afterEvolution = mergeProfileWithFacts(empty, facts, 'evo-1')
  const afterLabA: PatientProfile = {
    ...afterEvolution,
    labs: mergeConfirmedLabs(afterEvolution.labs, [{ name: 'HbA1c', value: 7.9, unit: '%' }]),
  }
  const afterLabB: PatientProfile = {
    ...afterLabA,
    labs: mergeConfirmedLabs(afterLabA.labs, [{ name: 'Filtrado glomerular estimado', value: 72, unit: 'mL/min/1,73 m²' }]),
  }

  it('1 · el borrador ordena lo dictado por bloques y aplica la corrección dicha en voz alta', () => {
    expect(draft.text).toContain('Medicación actual y adherencia: Metformina 850 mg cada 12 h.')
    expect(draft.text).toContain('Signos vitales: Presión arterial 132 sobre 84. Frecuencia cardíaca 72.')
    expect(draft.text).not.toContain('140 sobre 90')
    expect(draft.text).toContain('Eventos adversos: Ninguno.')
    expect(draft.corrections).toHaveLength(1)
    expect(draft.missing).toEqual(['evolucion', 'examen', 'laboratorio', 'evaluacion', 'criterios', 'proxima'])
  })

  it('2 · del borrador salen los hechos que se proponen al perfil: el valor corregido, no el dicho primero', () => {
    expect(facts.ageYears).toBe(58)
    expect([facts.systolic, facts.diastolic]).toEqual([132, 84])
    expect(facts.medications).toEqual([{ name: 'Metformina', dose: '850 mg', frequency: 'cada 12 h' }])
    expect(facts.labs).toEqual([])
  })

  it('3 · un sujeto sin datos no resuelve ningún criterio', () => {
    expect(resolved(empty)).toBe(0)
  })

  it('4 · la evolución aceptada resuelve la edad; la metformina queda a revisar porque el criterio pide tres meses estables', () => {
    expect(byNumber(afterEvolution)).toMatchObject({ I1: 'pass', I3: 'unknown', I2: 'unknown', E1: 'unknown' })
    expect(resolved(afterEvolution)).toBe(1)
  })

  it('5 · el primer laboratorio confirmado resuelve la HbA1c', () => {
    expect(byNumber(afterLabA).I2).toBe('pass')
    expect(resolved(afterLabA)).toBe(2)
  })

  it('6 · el segundo laboratorio confirmado resuelve el filtrado glomerular', () => {
    expect(byNumber(afterLabB).E1).toBe('pass')
    expect(resolved(afterLabB)).toBe(3)
  })

  it('7 · lo que ninguna regla puede decidir sigue a revisar, y nada quedó como incumplido', () => {
    expect(byNumber(afterLabB)).toMatchObject({ I3: 'unknown', I4: 'unknown', E2: 'unknown', E3: 'unknown', E4: 'unknown' })
    expect(screeningSummary(assessScreening(afterLabB, PROTOCOL)).fail).toBe(0)
  })

  it('8 · un valor fuera de rango cambia el resultado: el recorrido no es un camino feliz fijo', () => {
    const outOfRange: PatientProfile = {
      ...afterLabB,
      labs: mergeConfirmedLabs(afterLabB.labs, [{ name: 'HbA1c', value: 11.2, unit: '%' }]),
    }
    expect(byNumber(outOfRange).I2).toBe('fail')
  })
})
