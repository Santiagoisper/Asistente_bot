/**
 * terminology-answer.test.ts
 *
 * Cubre el camino híbrido de codificación clínica:
 *  1. lookupTerminology resuelve conceptos al código específico (longest-match).
 *  2. buildTerminologyAnswer compone los dos bloques y ajusta la confianza.
 *  3. El disclaimer de "sugerencia externa" siempre acompaña a los códigos.
 */

import { describe, it, expect } from 'vitest'
import { lookupTerminology } from '../medical-annotator'
import { buildTerminologyAnswer, TERMINOLOGY_DISCLAIMER } from '../terminology-answer'

describe('lookupTerminology', () => {
  it('resuelve "diabetes tipo 1" al código específico 46635009', () => {
    const out = lookupTerminology('diabetes tipo 1, no tenes referencia en snomed-ct?')
    expect(out).toHaveLength(1)
    expect(out[0]?.code).toBe('46635009')
    expect(out[0]?.system).toBe('SNOMED-CT')
    expect(out[0]?.source).toBe('dictionary')
  })

  it('prefiere el concepto específico sobre el genérico (no devuelve "diabetes" 73211009)', () => {
    const codes = lookupTerminology('diabetes tipo 1').map((s) => s.code)
    expect(codes).toContain('46635009')
    expect(codes).not.toContain('73211009')
  })

  it('deduplica por system+code', () => {
    const out = lookupTerminology('diabetes tipo 1 y diabetes tipo 1 de nuevo')
    expect(out).toHaveLength(1)
  })

  it('retorna [] cuando no hay concepto conocido', () => {
    expect(lookupTerminology('cuales son las ventanas de visita?')).toEqual([])
  })
})

describe('buildTerminologyAnswer', () => {
  const suggestions = [
    { term: 'diabetes tipo 1', system: 'SNOMED-CT' as const, code: '46635009', display: 'Diabetes mellitus type 1', source: 'dictionary' as const },
  ]

  it('cuando el protocolo menciona el concepto: confidence medium + ambos bloques', () => {
    const r = buildTerminologyAnswer({
      protocolAnswer: 'El protocolo define T1D como diabetes tipo 1 [1].',
      protocolConfidence: 'high',
      suggestions,
    })
    expect(r.confidence).toBe('medium')
    expect(r.protocolMentionsFound).toBe(true)
    expect(r.answer).toContain('El protocolo define T1D')
    expect(r.answer).toContain('46635009')
    expect(r.answer).toContain(TERMINOLOGY_DISCLAIMER)
    expect(r.terminologySuggestions).toHaveLength(1)
  })

  it('cuando el protocolo NO menciona el concepto pero hay código: confidence low + nota de protocolo sin códigos', () => {
    const r = buildTerminologyAnswer({
      protocolAnswer: 'No tengo información suficiente en los documentos disponibles para responder esta pregunta.',
      protocolConfidence: 'insufficient_evidence',
      suggestions,
    })
    expect(r.confidence).toBe('low')
    expect(r.protocolMentionsFound).toBe(false)
    expect(r.answer).toContain('no incluye códigos')
    expect(r.answer).toContain('46635009')
    expect(r.answer).toContain(TERMINOLOGY_DISCLAIMER)
    // No debe propagar el mensaje genérico de evidencia insuficiente.
    expect(r.answer).not.toContain('No tengo información suficiente')
  })

  it('sin código ni mención del protocolo: insufficient_evidence con mensaje específico', () => {
    const r = buildTerminologyAnswer({
      protocolAnswer: 'No tengo información suficiente...',
      protocolConfidence: 'insufficient_evidence',
      suggestions: [],
    })
    expect(r.confidence).toBe('insufficient_evidence')
    expect(r.terminologySuggestions).toEqual([])
    expect(r.answer).toContain('vocabulario de terminología')
  })

  it('protocolo responde pero sin código en diccionario: devuelve la respuesta tal cual', () => {
    const r = buildTerminologyAnswer({
      protocolAnswer: 'El protocolo menciona la condición X [1].',
      protocolConfidence: 'high',
      suggestions: [],
    })
    expect(r.confidence).toBe('high')
    expect(r.protocolMentionsFound).toBe(true)
    expect(r.terminologySuggestions).toEqual([])
    expect(r.answer).toBe('El protocolo menciona la condición X [1].')
  })
})
