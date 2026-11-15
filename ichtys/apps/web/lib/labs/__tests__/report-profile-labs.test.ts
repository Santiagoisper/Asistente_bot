import { patientProfileSchema } from '@ichtys/clinical'
import { describe, expect, it } from 'vitest'
import { reportRowsToProfileLabs } from '../report-profile-labs'

/**
 * C4 paso 2 (D1, prueba 8): lo que un informe confirmado le suma al perfil lleva de qué
 * informe salió. Es la función que usa `confirmLabReport`.
 */
const REPORT = '11111111-1111-4111-8111-111111111111'
const row = (overrides: Record<string, unknown>) => ({ analyte: 'HbA1c', value: 7.9, unit: '%', referenceRange: null, rawLine: 'x', confidence: 'high', ...overrides }) as never

describe('reportRowsToProfileLabs', () => {
  it('cada valor numérico sale con source = { kind: lab_report, reportId } exacto', () => {
    const labs = reportRowsToProfileLabs([row({}), row({ analyte: 'ALT', value: 31, unit: 'U/L', referenceRange: '  hasta 40 ' })], REPORT, '2026-09-24')
    expect(labs).toEqual([
      { name: 'HbA1c', value: 7.9, unit: '%', source: { kind: 'lab_report', reportId: REPORT }, sampleDate: '2026-09-24' },
      { name: 'ALT', value: 31, unit: 'U/L', referenceRange: 'hasta 40', source: { kind: 'lab_report', reportId: REPORT }, sampleDate: '2026-09-24' },
    ])
  })

  it('una fila sin valor numérico no llega al perfil', () => {
    expect(reportRowsToProfileLabs([row({ value: null }), row({ analyte: 'TSH', value: 2.4, unit: null })], REPORT, null)).toEqual([
      // Sin fecha confirmada queda `null`: desconocida, no ausente.
      { name: 'TSH', value: 2.4, source: { kind: 'lab_report', reportId: REPORT }, sampleDate: null },
    ])
  })

  it('lo que devuelve valida contra el esquema del perfil y conserva el origen', () => {
    const labs = reportRowsToProfileLabs([row({})], REPORT, '2026-09-24')
    const parsed = patientProfileSchema.parse({ version: 1, labs }).labs[0]!
    expect(parsed.source).toEqual({ kind: 'lab_report', reportId: REPORT })
    // La trampa del esquema: una clave que no conoce se descarta en silencio.
    expect(parsed.sampleDate).toBe('2026-09-24')
  })
})
