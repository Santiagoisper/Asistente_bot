/**
 * spec-normalizer — unidad de la regla "un tope nunca tumba más que el ítem
 * afectado" (regresión E5, vuelta 4).
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeCriterion,
  normalizeIdentification,
  normalizeStudySpec,
  normalizeVisit,
  normalizeVisitsGroup,
} from '../spec-normalizer'
import {
  emptyStudySpec,
  MAX_SPEC_EXTRACTION_WARNINGS,
  MAX_SPEC_IDENTIFICATION_CHARS,
  MAX_SPEC_PROCEDURE_CHARS,
  MAX_SPEC_SOURCE_PAGES,
  MAX_SPEC_TEXT_CHARS,
} from '../study-spec'

describe('normalizeCriterion', () => {
  it('un criterio válido pasa tal cual, sin advertencias', () => {
    const warnings: string[] = []
    const criterion = { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [52], confidence: 'high' as const }
    expect(normalizeCriterion(criterion, 'test', warnings)).toEqual(criterion)
    expect(warnings).toEqual([])
  })

  it('un criterio de 10.001 chars se recorta a 10.000 con una advertencia', () => {
    const warnings: string[] = []
    const out = normalizeCriterion(
      { number: '1', text: 'x'.repeat(MAX_SPEC_TEXT_CHARS + 1), sourcePages: [52], confidence: 'high' },
      'test',
      warnings,
    )
    expect(out?.text).toHaveLength(MAX_SPEC_TEXT_CHARS)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('texto recortado')
  })

  it('un criterio sin sourcePages válidas se descarta, sin tumbar a los demás', () => {
    const warnings: string[] = []
    expect(normalizeCriterion({ number: '1', text: 'válido', sourcePages: [], confidence: 'high' }, 'test', warnings)).toBeNull()
    expect(normalizeCriterion({ number: '2', text: 'sin páginas', sourcePages: [0, -1], confidence: 'high' }, 'test', warnings)).toBeNull()
    expect(warnings.every((warning) => warning.includes('descartado'))).toBe(true)
    expect(warnings).toHaveLength(2)
  })

  it('sourcePages con páginas inválidas mezcladas se filtran y recortan al tope', () => {
    const warnings: string[] = []
    const pages = [...Array.from({ length: MAX_SPEC_SOURCE_PAGES + 1 }, (_, i) => i + 1), 0, -3]
    const out = normalizeCriterion({ number: '1', text: 'ok', sourcePages: pages, confidence: 'high' }, 'test', warnings)
    expect(out?.sourcePages).toHaveLength(MAX_SPEC_SOURCE_PAGES)
    expect(warnings[0]).toContain(`sourcePages recortadas a ${MAX_SPEC_SOURCE_PAGES}`)
  })
})

describe('normalizeVisit / normalizeVisitsGroup', () => {
  it('un procedimiento de 601 chars se recorta a 500 con advertencia por ítem', () => {
    const warnings: string[] = []
    const out = normalizeVisit(
      { name: 'Visita 4', label: 'Semana 12', day: 85, windowDays: 3, procedures: ['ok', 'x'.repeat(MAX_SPEC_PROCEDURE_CHARS + 101)], sourcePages: [19], confidence: 'high' },
      warnings,
    )
    expect(out?.procedures[1]).toHaveLength(MAX_SPEC_PROCEDURE_CHARS)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('procedimientos recortados')
  })

  it('101 sourcePages se recortan a 100 y la visita sobrevive', () => {
    const warnings: string[] = []
    const out = normalizeVisit(
      { name: 'Visita 4', label: null, day: null, windowDays: null, procedures: ['HbA1c'], sourcePages: Array.from({ length: MAX_SPEC_SOURCE_PAGES + 1 }, (_, i) => i + 1), confidence: 'high' },
      warnings,
    )
    expect(out?.sourcePages).toHaveLength(MAX_SPEC_SOURCE_PAGES)
    expect(warnings[0]).toContain('sourcePages recortadas')
  })

  it('windowDays negativo se repara a null (no descarta la visita)', () => {
    const warnings: string[] = []
    const out = normalizeVisit(
      { name: 'Visita 4', label: null, day: 14, windowDays: -2, procedures: [], sourcePages: [19], confidence: 'high' },
      warnings,
    )
    expect(out?.windowDays).toBeNull()
    expect(warnings[0]).toContain('invalid visit window')
  })

  it('una visita sin sourcePages válidas o con confidence inválida se descarta con advertencia', () => {
    const warnings: string[] = []
    const group = normalizeVisitsGroup(
      {
        visits: [
          { name: 'Válida', label: null, day: 1, windowDays: null, procedures: ['ECG'], sourcePages: [2], confidence: 'high' },
          { name: 'Sin páginas', label: null, day: 1, windowDays: null, procedures: ['ECG'], sourcePages: [], confidence: 'high' },
          { name: 'Confianza rota', label: null, day: 1, windowDays: null, procedures: ['ECG'], sourcePages: [3], confidence: 'seguro' },
        ],
      },
      warnings,
    )
    expect(group.visits).toHaveLength(1)
    expect(group.visits[0]?.name).toBe('Válida')
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('descartado'),
      expect.stringContaining('descartado'),
    ]))
  })
})

describe('normalizeIdentification', () => {
  it('un título de más de 2000 chars se recorta; el resto queda intacto', () => {
    const warnings: string[] = []
    const out = normalizeIdentification(
      { protocolCode: 'FICT-2026-01', title: 't'.repeat(MAX_SPEC_IDENTIFICATION_CHARS + 5), phase: 'Fase III', sourcePages: [1] },
      warnings,
    )
    expect(out.protocolCode).toBe('FICT-2026-01')
    expect(out.title).toHaveLength(MAX_SPEC_IDENTIFICATION_CHARS)
    expect(warnings[0]).toContain('title recortado')
  })

  it('un objeto insalvable no tumba la extracción: identificación vacía', () => {
    const warnings: string[] = []
    const out = normalizeIdentification('no soy un objeto', warnings)
    expect(out).toEqual({ protocolCode: null, title: null, phase: null, sourcePages: [] })
  })
})

describe('normalizeStudySpec', () => {
  it('idempotente sobre un spec válido: sin cambios ni advertencias', () => {
    const warnings: string[] = []
    const spec = {
      ...emptyStudySpec(),
      inclusionCriteria: [
        { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [52], confidence: 'high' as const },
      ],
      visits: [
        { name: 'Visita 1', label: 'Día -35', day: -35, windowDays: null, procedures: ['Consentimiento'], sourcePages: [18], confidence: 'high' as const },
      ],
      extractionWarnings: ['una advertencia'],
    }
    expect(normalizeStudySpec(spec, warnings)).toEqual(spec)
    expect(warnings).toEqual([])
  })

  it('250 advertencias → 200, y una de 1500 chars → 1000', () => {
    const warnings: string[] = []
    const out = normalizeStudySpec(
      {
        ...emptyStudySpec(),
        extractionWarnings: ['y'.repeat(1500), ...Array.from({ length: 250 }, () => 'w')],
      },
      warnings,
    )
    expect(out.extractionWarnings).toHaveLength(MAX_SPEC_EXTRACTION_WARNINGS)
    expect(out.extractionWarnings?.[0]).toHaveLength(1000)
    expect(warnings.some((w) => w.includes('advertencias recortadas'))).toBe(true)
  })
})
