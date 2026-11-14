import { describe, expect, it } from 'vitest'
import { mergeProfileWithExtraction } from '../extract-merge'
import { mergeProfileWithFacts } from '../extract-facts'
import { parsePatientProfile, patientProfileSchema, type PatientProfile } from '../profile-schema'

/**
 * D24: lo que una persona retira del perfil porque entró desde una evolución anulada no se
 * destruye. Queda en `retiredFacts`, dentro del perfil cifrado, con de qué evolución era, quién
 * lo retiró y cuándo. Este paso solo enseña a leerlo y a no perderlo: todavía nadie lo escribe.
 *
 * El esquema del perfil descarta las claves que no conoce. Por eso va primero el lector: si el
 * que escribe llegara antes, cualquier otra escritura del perfil borraría el campo sin avisar.
 */
const EVO = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const retired = {
  evolutionId: EVO,
  retiredAt: '2026-11-14T20:00:00.000Z',
  retiredBy: 'user_md',
  labs: [{ name: 'ferritina', value: 480, unit: 'ng/mL', source: { kind: 'evolution' as const, evolutionId: EVO } }],
  medications: [{ name: 'Atorvastatina', dose: '20 mg' }],
  conditions: ['Hipotiroidismo'],
  ageYears: 61,
  vitals: { systolic: 150, diastolic: 95, bloodPressureLabel: '150/95' },
}

/** Un perfil con todos los campos del esquema cargados. */
const full = (): PatientProfile =>
  parsePatientProfile({
    version: 1,
    demographics: { ageYears: 58 },
    vitals: { systolic: 132, diastolic: 84, bloodPressureLabel: '132/84' },
    labs: [{ name: 'HbA1c', value: 7.9, unit: '%' }],
    medications: [{ name: 'Metformina' }],
    conditions: ['Diabetes tipo 2'],
    fieldConfidence: { ageYears: 'high', labs: { hba1c: 'high' } },
    pendingLabReview: { requiresHumanReview: true, extractedAt: '2026-11-14T10:00:00.000Z', labs: [{ name: 'Urea', value: 30 }] },
    pendingEvolutionProposals: [
      { requiresHumanReview: true, evolutionId: OTHER, extractedAt: '2026-11-14T11:00:00.000Z', facts: { labs: [], medications: [], conditions: [] }, fieldConfidence: {} },
    ],
    retiredFacts: [retired],
    lastUpdatedAt: '2026-11-14T12:00:00.000Z',
    lastEvolutionId: OTHER,
  })

describe('perfil del sujeto — lo retirado por venir de una evolución anulada', () => {
  it('se lee tal como se guardó: el esquema no lo descarta', () => {
    expect(full().retiredFacts).toEqual([retired])
  })

  it('un perfil anterior, sin el campo, se lee igual que antes', () => {
    const profile = parsePatientProfile({ version: 1, labs: [{ name: 'HbA1c', value: 7.9 }] })
    expect(profile).not.toHaveProperty('retiredFacts')
    expect(profile.labs).toHaveLength(1)
  })

  it('una entrada sin nada retirado es válida: «revisé, y no había nada que sacar»', () => {
    const profile = parsePatientProfile({ version: 1, retiredFacts: [{ evolutionId: EVO, retiredAt: '2026-11-14T20:00:00.000Z', retiredBy: 'user_md' }] })
    expect(profile.retiredFacts).toEqual([{ evolutionId: EVO, retiredAt: '2026-11-14T20:00:00.000Z', retiredBy: 'user_md', labs: [], medications: [], conditions: [] }])
  })

  it('sin de qué evolución era o sin quién lo retiró, no valida', () => {
    expect(patientProfileSchema.safeParse({ version: 1, retiredFacts: [{ retiredAt: 'x', retiredBy: 'user_md' }] }).success).toBe(false)
    expect(patientProfileSchema.safeParse({ version: 1, retiredFacts: [{ evolutionId: EVO, retiredAt: 'x' }] }).success).toBe(false)
  })

  it('aceptar después otra propuesta no lo pierde', () => {
    const next = mergeProfileWithExtraction(full(), { facts: { labs: [{ name: 'Glucosa', value: 110 }], medications: [], conditions: [] }, fieldConfidence: {} }, OTHER)
    expect(next.retiredFacts).toEqual([retired])
    // Y lo retirado no vuelve a los datos vigentes.
    expect(next.labs.map((lab) => lab.name)).toEqual(['HbA1c', 'Glucosa'])
  })

  it('la mezcla por reglas tampoco', () => {
    const next = mergeProfileWithFacts(full(), { labs: [], medications: [], conditions: [] }, OTHER)
    expect(next.retiredFacts).toEqual([retired])
  })
})

/**
 * Guardián: `mergeProfileWithExtraction` arma el perfil de cero, campo por campo. Un campo nuevo
 * del esquema que no se copie ahí se pierde la próxima vez que alguien acepte una propuesta.
 * Esta prueba recorre el esquema: si se agrega un campo y no se lo copia, falla acá.
 */
describe('perfil del sujeto — ninguna mezcla pierde un campo del esquema', () => {
  it.each(Object.keys(patientProfileSchema.shape))('aceptar una propuesta conserva «%s»', (key) => {
    const before = full()
    expect(before).toHaveProperty(key)
    const next = mergeProfileWithExtraction(before, { facts: { labs: [], medications: [], conditions: [] }, fieldConfidence: {} }, OTHER)
    expect(next).toHaveProperty(key)
  })
})
