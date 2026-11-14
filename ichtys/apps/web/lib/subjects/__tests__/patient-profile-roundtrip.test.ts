import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parsePatientProfile, patientProfileSchema } from '@ichtys/clinical'
import { decryptProfileJson, decryptStoredProfile, encryptProfileJson } from '../phi-fields'

// Key de test local (64 hex = 32 bytes), mismo formato que exige phi-crypto.
// No es una credential: sólo existe para este proceso de vitest.
const TEST_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)

/**
 * ADR-8 M6: profileFieldConfidenceSchema (z.record) cambia de firma en el
 * paso 1b. El perfil del paciente se guarda CIFRADO en producción con el
 * formato histórico — un perfil viejo tiene que seguir descifrando y
 * validando campo por campo. Si este test se rompe, se perdió lectura de
 * datos existentes.
 */
const legacyProfile = {
  version: 1,
  demographics: { ageYears: 63 },
  vitals: { systolic: 128, diastolic: 82, bloodPressureLabel: 'normal-alta' },
  labs: [
    { name: 'HbA1c', value: 8.2, unit: '%' },
    {
      name: 'LDL',
      value: 141.7,
      unit: 'mg/dL',
      sourceEvolutionId: '11111111-1111-4111-8111-111111111111',
    },
  ],
  medications: [{ name: 'Metformina', dose: '850 mg', frequency: 'cada 12 h' }],
  conditions: ['Diabetes tipo 2', 'Hipotiroidismo'],
  fieldConfidence: {
    ageYears: 'high',
    bloodPressure: 'medium',
    labs: { hba1c: 'high', ldl: 'low' },
    medications: { metformina: 'medium' },
    conditions: { 'diabetes tipo 2': 'high' },
  },
  lastUpdatedAt: '2026-10-01T10:00:00.000Z',
  lastEvolutionId: '22222222-2222-4222-8222-222222222222',
}

describe('round-trip del perfil del paciente guardado en formato viejo (ADR-8 M6)', () => {
  beforeEach(() => {
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY
  })

  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY
  })

  it('se cifra, se descifra y valida campo por campo sin pérdida', () => {
    const encrypted = encryptProfileJson(legacyProfile)
    // Cifrado de verdad: nada del contenido viaja en claro.
    expect(encrypted).not.toContain('HbA1c')
    expect(encrypted).not.toContain('Metformina')

    const round = parsePatientProfile(decryptProfileJson(encrypted))
    // C4 D1/D5: el LDL guardado con sourceEvolutionId sale con su origen
    // traducido a la única forma nueva; el HbA1c sin origen sale sin origen.
    // Nada se pierde: sourceEvolutionId se conserva tal cual.
    expect(round).toEqual({
      ...legacyProfile,
      labs: [
        { name: 'HbA1c', value: 8.2, unit: '%' },
        {
          name: 'LDL',
          value: 141.7,
          unit: 'mg/dL',
          sourceEvolutionId: '11111111-1111-4111-8111-111111111111',
          source: {
            kind: 'evolution',
            evolutionId: '11111111-1111-4111-8111-111111111111',
          },
        },
      ],
    })
  })

  it('el record de confianza acepta claves arbitrarias (formato histórico)', () => {
    const encrypted = encryptProfileJson({
      ...legacyProfile,
      fieldConfidence: {
        labs: { 'creatinina sérica': 'medium', 'colesterol total': 'low' },
      },
    })
    const round = parsePatientProfile(decryptProfileJson(encrypted))
    expect(round.fieldConfidence?.labs).toEqual({
      'creatinina sérica': 'medium',
      'colesterol total': 'low',
    })
  })

  it('C4: source y sampleDate sobreviven cifrar, guardar y leer (valores exactos)', () => {
    const profile = {
      ...legacyProfile,
      labs: [
        {
          name: 'Hemoglobina',
          value: 13.5,
          unit: 'g/dL',
          source: { kind: 'lab_report', reportId: '33333333-3333-4333-8333-333333333333' },
          sampleDate: '2026-09-24',
        },
        {
          name: 'HbA1c',
          value: 8.2,
          unit: '%',
          source: { kind: 'pasted_text' },
          sampleDate: null,
        },
      ],
    }
    const encrypted = encryptProfileJson(profile)
    expect(encrypted).not.toContain('Hemoglobina')

    const round = parsePatientProfile(decryptProfileJson(encrypted))
    expect(round.labs).toEqual([
      {
        name: 'Hemoglobina',
        value: 13.5,
        unit: 'g/dL',
        source: { kind: 'lab_report', reportId: '33333333-3333-4333-8333-333333333333' },
        sampleDate: '2026-09-24',
      },
      {
        name: 'HbA1c',
        value: 8.2,
        unit: '%',
        source: { kind: 'pasted_text' },
        sampleDate: null,
      },
    ])
  })

  it('C4: un sampleDate mal formado hace que el perfil guardado no valide, y dice qué campo es', () => {
    const encrypted = encryptProfileJson({
      ...legacyProfile,
      labs: [{ name: 'HbA1c', value: 8.2, unit: '%', sampleDate: '24/09/2026' }],
    })
    // Una fecha que no es YYYY-MM-DD no puede leerse como si nada. Pero un perfil que no se
    // pudo leer no es un perfil vacío: lo correcto es que no valide (la ficha lo avisa y la
    // escritura se corta: #147, #151, #152), no que salga vacío como si no hubiera datos.
    const stored = patientProfileSchema.safeParse(decryptStoredProfile(encrypted))
    expect(stored.success).toBe(false)
    if (stored.success) return
    expect(stored.error.issues.map((issue) => issue.path)).toEqual([['labs', 0, 'sampleDate']])
  })
})
