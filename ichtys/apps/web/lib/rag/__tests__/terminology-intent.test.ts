/**
 * terminology-intent.test.ts
 *
 * Verifica la detección de preguntas de codificación clínica y la extracción
 * de conceptos contra el diccionario.
 */

import { describe, it, expect } from 'vitest'
import { detectTerminologyIntent } from '../terminology-intent'

describe('detectTerminologyIntent', () => {
  it('detecta intent y resuelve el concepto en "diabetes tipo 1, no tenes referencia en snomed-ct?"', () => {
    const r = detectTerminologyIntent('diabetes tipo 1, no tenes referencia en snomed-ct?')
    expect(r.isTerminologyQuery).toBe(true)
    expect(r.suggestions.map((s) => s.code)).toContain('46635009')
  })

  it('detecta intent con "asociar a un codigo de snomed-ct"', () => {
    const r = detectTerminologyIntent('Lo podes asociar ahora a un codigo de snomed-ct?')
    expect(r.isTerminologyQuery).toBe(true)
  })

  it('detecta intent aun sin concepto resoluble (suggestions vacías)', () => {
    const r = detectTerminologyIntent('cual es el codigo SNOMED de este biomarcador raro?')
    expect(r.isTerminologyQuery).toBe(true)
    expect(r.suggestions).toEqual([])
  })

  it('NO marca intent en preguntas operativas normales', () => {
    const r = detectTerminologyIntent('cuales son los criterios de inclusion?')
    expect(r.isTerminologyQuery).toBe(false)
    expect(r.suggestions).toEqual([])
  })
})
