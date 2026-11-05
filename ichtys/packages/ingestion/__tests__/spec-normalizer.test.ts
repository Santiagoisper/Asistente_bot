/**
 * spec-normalizer — unidad de la regla "un tope nunca tumba más que el ítem
 * afectado" (regresión E5, vuelta 4).
 */
import { describe, expect, it } from 'vitest'
import {
  capExtractionWarnings,
  normalizeCriterion,
  normalizeEligibilityGroup,
  normalizeIdentification,
  normalizeStudySpec,
  normalizeVisit,
  normalizeVisitsGroup,
  warningCodeSummary,
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
      'visits: visita #1',
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
      'visits: visita #1',
      warnings,
    )
    expect(out?.sourcePages).toHaveLength(MAX_SPEC_SOURCE_PAGES)
    expect(warnings[0]).toContain('sourcePages recortadas')
  })

  it('windowDays negativo se repara a null (no descarta la visita)', () => {
    const warnings: string[] = []
    const out = normalizeVisit(
      { name: 'Visita 4', label: null, day: 14, windowDays: -2, procedures: [], sourcePages: [19], confidence: 'high' },
      'visits: visita #1',
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

describe('B1 — una lista ausente nunca queda vacía en silencio', () => {
  it('normalizeEligibilityGroup con una sola clave advierte la lista faltante', () => {
    const warnings: string[] = []
    const group = normalizeEligibilityGroup(
      {
        inclusionCriteria: [
          { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [52], confidence: 'high' },
        ],
      },
      warnings,
    )
    expect(group.inclusionCriteria).toHaveLength(1)
    expect(group.exclusionCriteria).toEqual([])
    expect(warnings).toContain('eligibility: exclusion: ausente o inválido en la salida del modelo — 0 ítems')
  })

  it('clave presente pero no-arreglo (string) da la misma advertencia, nombrando la lista', () => {
    const warnings: string[] = []
    const group = normalizeEligibilityGroup({ inclusionCriteria: [], exclusionCriteria: 'ninguno' }, warnings)
    expect(group.exclusionCriteria).toEqual([])
    expect(warnings.some((warning) => warning.includes('exclusion') && warning.includes('ausente o inválido'))).toBe(true)
  })
})

describe('G4-S1 — ninguna advertencia copia contenido del documento', () => {
  it('recortes con marcador y salto de línea en number/name/objective: sólo categoría e índice', () => {
    const marker = 'PACIENTE_FICTICIO_123\nINYECCION_LOG'
    const warnings: string[] = []
    normalizeStudySpec(
      {
        ...emptyStudySpec(),
        inclusionCriteria: [
          { number: marker, text: 'x'.repeat(MAX_SPEC_TEXT_CHARS + 1), sourcePages: [52], confidence: 'high' },
        ],
        exclusionCriteria: [{ number: marker, text: 'sin páginas', sourcePages: [], confidence: 'high' }],
        endpoints: [
          { type: 'primary', objective: marker, endpoint: 'y'.repeat(MAX_SPEC_TEXT_CHARS + 1), sourcePages: [5], confidence: 'high' },
        ],
        visits: [
          { name: marker, label: null, day: 1, windowDays: null, procedures: ['ok', 'z'.repeat(MAX_SPEC_PROCEDURE_CHARS + 1)], sourcePages: [19], confidence: 'high' },
        ],
      },
      warnings,
    )
    expect(warnings.length).toBeGreaterThanOrEqual(4)
    for (const warning of warnings) {
      expect(warning).not.toContain('PACIENTE_FICTICIO_123')
      expect(warning).not.toContain('INYECCION_LOG')
      expect(warning).not.toContain('\n')
    }
    expect(warnings.some((warning) => warning.includes('visita #1'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('criterio #1'))).toBe(true)
  })
})

describe('confianza — un ítem reparado baja su confidence a low (N1/O2)', () => {
  it('criterio recortado: high → low y la advertencia lo registra', () => {
    const warnings: string[] = []
    const out = normalizeCriterion(
      { number: '1', text: 'x'.repeat(MAX_SPEC_TEXT_CHARS + 1), sourcePages: [52], confidence: 'high' },
      'test',
      warnings,
    )
    expect(out?.confidence).toBe('low')
    expect(warnings[0]).toContain('low')
  })

  it('visita con procedimiento largo baja a low; la válida vecina conserva su confidence', () => {
    const warnings: string[] = []
    const group = normalizeVisitsGroup(
      {
        visits: [
          { name: 'Válida', label: null, day: 1, windowDays: null, procedures: ['ECG'], sourcePages: [2], confidence: 'high' },
          { name: 'Reparada', label: null, day: 1, windowDays: null, procedures: ['x'.repeat(MAX_SPEC_PROCEDURE_CHARS + 1)], sourcePages: [3], confidence: 'medium' },
        ],
      },
      warnings,
    )
    expect(group.visits[0]?.confidence).toBe('high')
    expect(group.visits[1]?.confidence).toBe('low')
  })

  it('un criterio válido conserva su confidence original (sin reparación no hay cambio)', () => {
    const warnings: string[] = []
    const out = normalizeCriterion(
      { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [1], confidence: 'medium' },
      'test',
      warnings,
    )
    expect(out?.confidence).toBe('medium')
    expect(warnings).toEqual([])
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

describe('warningCodeSummary — lista blanca de códigos (H1)', () => {
  it('agrupa sólo los códigos conocidos por su prefijo', () => {
    expect(
      warningCodeSummary([
        'visits: duplicate_visit_name index=1,2',
        'visits: visita #3: recortado',
        'eligibility: exclusion: ausente o inválido en la salida del modelo — 0 ítems',
        'extractionWarnings: 250 advertencias recortadas al tope de 200',
      ]),
    ).toBe('visits×2, eligibility×1, extractionWarnings×1')
  })

  it('un prefijo desconocido se agrupa como «otros» y nunca se loguea el texto', () => {
    const summary = warningCodeSummary([
      'PACIENTE_FICTICIO_123: detalle clínico',
      'otro prefijo libre: más texto',
      'sin dos puntos',
    ])
    expect(summary).toBe('otros×3')
    expect(summary).not.toContain('PACIENTE_FICTICIO_123')
    expect(summary).not.toContain('detalle clínico')
  })
})

describe('capExtractionWarnings — prioridad y segundo recorte (observaciones del Architect)', () => {
  it('conserva una lista «ausente o inválido» aunque esté al final de >200', () => {
    const list = [
      ...Array.from({ length: 250 }, (_, i) => `visits: advertencia ${i + 1}`),
      'eligibility: exclusion: ausente o inválido en la salida del modelo — 0 ítems',
    ]

    const out = capExtractionWarnings(list)

    expect(out).toHaveLength(MAX_SPEC_EXTRACTION_WARNINGS)
    expect(out.some((warning) => warning.includes('ausente o inválido'))).toBe(true)
    expect(out.at(-1)).toMatch(/^… y \d+ advertencias? más$/)
  })

  it('un segundo recorte no duplica el resumen y suma lo ya omitido', () => {
    const first = capExtractionWarnings(
      Array.from({ length: 250 }, (_, i) => `visits: advertencia ${i + 1}`),
    )
    expect(first.at(-1)).toBe('… y 51 advertencias más')

    const second = capExtractionWarnings([
      ...first,
      'eligibility: exclusion: ausente o inválido en la salida del modelo — 0 ítems',
    ])

    const summaries = second.filter((warning) => /^… y \d+ advertencias? más$/.test(warning))
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toBe('… y 52 advertencias más')
    expect(second).toHaveLength(MAX_SPEC_EXTRACTION_WARNINGS)
  })
})


