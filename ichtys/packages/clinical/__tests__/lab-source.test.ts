import { describe, expect, it } from 'vitest'
import { mergeProfileWithExtraction } from '../extract-merge'
import { labsFromLabReport, labsFromPastedText } from '../lab-source'
import { emptyPatientProfile, patientProfileSchema } from '../profile-schema'

/**
 * C4 paso 2 (docs/decisions/huella-y-procedencia-de-archivos.md, D1 y prueba 8): los tres
 * caminos que escriben `profile.labs` dejan su origen, con el valor exacto. La fecha de la
 * muestra todavía no se escribe (paso 3).
 */
const REPORT = '11111111-1111-4111-8111-111111111111'
const EVOLUTION = '22222222-2222-4222-8222-222222222222'

describe('camino 1 — informe de laboratorio confirmado', () => {
  it('cada valor sale con source = { kind: lab_report, reportId } exacto', () => {
    const labs = labsFromLabReport([{ name: 'HbA1c', value: 7.9, unit: '%' }, { name: 'ALT', value: 31, unit: 'U/L', referenceRange: 'hasta 40' }], REPORT)
    expect(labs).toEqual([
      { name: 'HbA1c', value: 7.9, unit: '%', source: { kind: 'lab_report', reportId: REPORT } },
      { name: 'ALT', value: 31, unit: 'U/L', referenceRange: 'hasta 40', source: { kind: 'lab_report', reportId: REPORT } },
    ])
  })

  it('no arrastra un origen ajeno que venga en el valor', () => {
    const labs = labsFromLabReport([{ name: 'HbA1c', value: 7.9, sourceEvolutionId: EVOLUTION, source: { kind: 'evolution', evolutionId: EVOLUTION } }], REPORT)
    expect(labs).toEqual([{ name: 'HbA1c', value: 7.9, source: { kind: 'lab_report', reportId: REPORT } }])
  })
})

describe('camino 2 — texto pegado y revisado', () => {
  it('cada valor sale con source = { kind: pasted_text } exacto', () => {
    expect(labsFromPastedText([{ name: 'Glucemia', value: 132, unit: 'mg/dL' }])).toEqual([
      { name: 'Glucemia', value: 132, unit: 'mg/dL', source: { kind: 'pasted_text' } },
    ])
  })

  it('lo que mande quien confirma no puede hacerse pasar por un informe ni por una evolución', () => {
    const labs = labsFromPastedText([{ name: 'Glucemia', value: 132, sourceEvolutionId: EVOLUTION, source: { kind: 'lab_report', reportId: REPORT } }])
    expect(labs).toEqual([{ name: 'Glucemia', value: 132, source: { kind: 'pasted_text' } }])
  })
})

describe('camino 3 — propuesta de una evolución, aceptada', () => {
  it('source = { kind: evolution, evolutionId } exacto, y sourceEvolutionId se conserva', () => {
    const merged = mergeProfileWithExtraction(
      emptyPatientProfile(),
      { facts: { labs: [{ name: 'HbA1c', value: 7.5, unit: '%' }], medications: [], conditions: [] }, fieldConfidence: {} } as never,
      EVOLUTION,
    )
    expect(merged.labs).toHaveLength(1)
    expect(merged.labs[0]!.source).toEqual({ kind: 'evolution', evolutionId: EVOLUTION })
    expect(merged.labs[0]!.sourceEvolutionId).toBe(EVOLUTION)
  })
})

describe('el origen sobrevive al esquema del perfil (la trampa del objeto que descarta claves)', () => {
  it('los tres orígenes validan y salen iguales después de pasar por el esquema', () => {
    const labs = [
      ...labsFromLabReport([{ name: 'HbA1c', value: 7.9, unit: '%' }], REPORT),
      ...labsFromPastedText([{ name: 'Glucemia', value: 132 }]),
      { name: 'Creatinina', value: 0.9, sourceEvolutionId: EVOLUTION, source: { kind: 'evolution' as const, evolutionId: EVOLUTION } },
    ]
    const parsed = patientProfileSchema.parse({ version: 1, labs })
    expect(parsed.labs.map((lab) => lab.source)).toEqual([
      { kind: 'lab_report', reportId: REPORT },
      { kind: 'pasted_text' },
      { kind: 'evolution', evolutionId: EVOLUTION },
    ])
  })
})
