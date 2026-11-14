import { describe, expect, it } from 'vitest'
import { parsePatientProfile, patientProfileSchema, type PatientProfile } from '@ichtys/clinical'
import { retireFromVoidedEvolution, RetireSelectionError } from '../voided-origin-retire'

/**
 * D24, punto 4 bis: una persona retira del perfil lo que entró desde una evolución anulada.
 * Los laboratorios de ese origen salen todos; la edad, la presión, las medicaciones y las
 * condiciones, solo lo que la persona eligió. Lo retirado no se destruye: queda en
 * `retiredFacts`, con de qué evolución era, quién lo retiró y cuándo.
 */
const VOIDED = '11111111-1111-4111-8111-111111111111'
const CURRENT = '22222222-2222-4222-8222-222222222222'
const AT = new Date('2026-11-14T21:00:00.000Z')
const fromEvolution = (name: string, value: number, evolutionId: string) => ({ name, value, source: { kind: 'evolution' as const, evolutionId } })

const base = (): PatientProfile =>
  parsePatientProfile({
    version: 1,
    demographics: { ageYears: 61 },
    vitals: { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' },
    labs: [
      fromEvolution('Ferritina', 480, VOIDED),
      { name: 'TSH', value: 2.1, sourceEvolutionId: VOIDED },
      fromEvolution('Glucosa', 110, CURRENT),
      { name: 'HbA1c', value: 7.9, source: { kind: 'lab_report', reportId: '33333333-3333-4333-8333-333333333333' } },
    ],
    medications: [{ name: 'Metformina' }, { name: 'Atorvastatina', dose: '20 mg' }],
    conditions: ['Diabetes tipo 2', 'Hipotiroidismo'],
    fieldConfidence: {
      ageYears: 'medium',
      bloodPressure: 'medium',
      labs: { ferritina: 'medium', tsh: 'low', glucosa: 'high' },
      medications: { metformina: 'high', atorvastatina: 'medium' },
      conditions: { 'diabetes tipo 2': 'high', hipotiroidismo: 'medium' },
    },
    pendingEvolutionProposals: [{ requiresHumanReview: true, evolutionId: CURRENT, extractedAt: '2026-11-14T11:00:00.000Z', facts: { labs: [], medications: [], conditions: [] }, fieldConfidence: {} }],
    lastEvolutionId: VOIDED,
  })

const retire = (profile: PatientProfile, selection: Partial<Parameters<typeof retireFromVoidedEvolution>[1]> = {}) =>
  retireFromVoidedEvolution(profile, { evolutionId: VOIDED, by: 'user_md', at: AT, ...selection })

describe('retireFromVoidedEvolution', () => {
  it('saca todos los laboratorios de esa evolución, en la forma nueva y en la anterior, y ninguno más', () => {
    const { profile, removed } = retire(base())
    expect(profile.labs.map((lab) => lab.name)).toEqual(['Glucosa', 'HbA1c'])
    expect(removed).toEqual({ labs: 2, medications: 0, conditions: 0, age: false, bloodPressure: false })
  })

  it('un laboratorio que una evolución vigente volvió a traer ya no es de ese origen: se queda', () => {
    const profile = parsePatientProfile({ version: 1, labs: [fromEvolution('Ferritina', 120, CURRENT)] })
    const result = retire(profile)
    expect(result.profile.labs).toHaveLength(1)
    expect(result.removed.labs).toBe(0)
  })

  it('edad, presión, medicaciones y condiciones salen solo si la persona las eligió', () => {
    const untouched = retire(base()).profile
    expect(untouched.demographics?.ageYears).toBe(61)
    expect(untouched.vitals?.systolic).toBe(150)
    expect(untouched.medications).toHaveLength(2)
    expect(untouched.conditions).toHaveLength(2)

    const { profile, removed } = retire(base(), { removeAge: true, removeBloodPressure: true, medications: ['atorvastatina'], conditions: ['Hipotiroidismo'] })
    expect(profile.demographics?.ageYears).toBeUndefined()
    expect(profile.vitals?.systolic).toBeUndefined()
    expect(profile.vitals?.diastolic).toBeUndefined()
    expect(profile.vitals?.bloodPressureLabel).toBeUndefined()
    expect(profile.medications.map((med) => med.name)).toEqual(['Metformina'])
    expect(profile.conditions).toEqual(['Diabetes tipo 2'])
    expect(removed).toEqual({ labs: 2, medications: 1, conditions: 1, age: true, bloodPressure: true })
  })

  it('lo retirado no se destruye: queda en retiredFacts con la evolución, quién y cuándo, y con los valores', () => {
    const { profile } = retire(base(), { removeAge: true, removeBloodPressure: true, medications: ['Atorvastatina'], conditions: ['hipotiroidismo'] })
    expect(profile.retiredFacts).toHaveLength(1)
    const entry = profile.retiredFacts![0]!
    expect(entry).toMatchObject({ evolutionId: VOIDED, retiredBy: 'user_md', retiredAt: AT.toISOString(), ageYears: 61, vitals: { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' }, conditions: ['Hipotiroidismo'] })
    expect(entry.labs.map((lab) => [lab.name, lab.value])).toEqual([['Ferritina', 480], ['TSH', 2.1]])
    expect(entry.medications).toEqual([{ name: 'Atorvastatina', dose: '20 mg' }])
  })

  it('con lo retirado se va también su confianza, y la de lo que queda no se toca', () => {
    const { profile } = retire(base(), { removeAge: true, removeBloodPressure: true, medications: ['Atorvastatina'], conditions: ['Hipotiroidismo'] })
    expect(profile.fieldConfidence).toEqual({ labs: { glucosa: 'high' }, medications: { metformina: 'high' }, conditions: { 'diabetes tipo 2': 'high' } })
  })

  it('una revisión sin nada que sacar deja igual su entrada: «revisé y no había nada»', () => {
    const profile = parsePatientProfile({ version: 1, labs: [fromEvolution('Glucosa', 110, CURRENT)] })
    const result = retire(profile)
    expect(result.profile.retiredFacts).toEqual([{ evolutionId: VOIDED, retiredAt: AT.toISOString(), retiredBy: 'user_md', labs: [], medications: [], conditions: [] }])
    expect(result.profile.labs).toHaveLength(1)
  })

  it('una segunda revisión de la misma evolución suma una entrada; la primera no se pisa', () => {
    const first = retire(base()).profile
    const second = retireFromVoidedEvolution(first, { evolutionId: VOIDED, by: 'user_otro', at: new Date('2026-11-15T10:00:00.000Z'), medications: ['Atorvastatina'] }).profile
    expect(second.retiredFacts?.map((entry) => [entry.retiredBy, entry.labs.length, entry.medications.length])).toEqual([['user_md', 2, 0], ['user_otro', 0, 1]])
  })

  it('pedir que salga una medicación o una condición que no está en el perfil no cambia nada: alguien lo modificó mientras tanto', () => {
    expect(() => retire(base(), { medications: ['Enalapril'] })).toThrow(RetireSelectionError)
    expect(() => retire(base(), { conditions: ['Asma'] })).toThrow(RetireSelectionError)
  })

  it('lo demás del perfil sigue: propuestas pendientes, lo ya retirado antes, y el resultado valida', () => {
    const before = { ...base(), retiredFacts: [{ evolutionId: CURRENT, retiredAt: '2026-11-13T10:00:00.000Z', retiredBy: 'user_x', labs: [], medications: [], conditions: [] }] }
    const { profile } = retire(before)
    expect(profile.pendingEvolutionProposals).toHaveLength(1)
    expect(profile.retiredFacts?.map((entry) => entry.evolutionId)).toEqual([CURRENT, VOIDED])
    expect(patientProfileSchema.safeParse(profile).success).toBe(true)
  })

  it('si la última evolución que escribió el perfil era la anulada, deja de figurar como la última', () => {
    expect(retire(base()).profile.lastEvolutionId).toBeUndefined()
    expect(retire({ ...base(), lastEvolutionId: CURRENT }).profile.lastEvolutionId).toBe(CURRENT)
  })

  it('no modifica el perfil que recibe', () => {
    const profile = base()
    const copy = structuredClone(profile)
    retire(profile, { removeAge: true, medications: ['Atorvastatina'] })
    expect(profile).toEqual(copy)
  })
})
