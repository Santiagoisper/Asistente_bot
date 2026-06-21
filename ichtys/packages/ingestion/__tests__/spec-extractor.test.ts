import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-anthropic-model')
  return {
    mockModel,
    anthropicProviderFn: vi.fn().mockReturnValue(mockModel),
    generateObject: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(mocks.anthropicProviderFn),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))

// @ichtys/db: el package se importa transitivamente via study-spec → ninguna
// dependencia de DB en estos módulos, pero spec-store sí la usa. Este test no
// importa spec-store.

import {
  buildSectionContext,
  extractStudySpec,
  locateSection,
  MAX_SECTION_PAGES,
  SPEC_EXTRACTION_SYSTEM_PROMPT,
} from '../spec-extractor'
import { studySpecSchema } from '../study-spec'
import type { ParsedPage } from '../parser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function page(pageNumber: number, rawText: string): ParsedPage {
  return { pageNumber, rawText }
}

/** Protocolo mínimo con TOC (que debe saltarse) y cuerpo real. */
function makeProtocolPages(): ParsedPage[] {
  return [
    page(1, 'Protocolo J1I-MC-GZBP\nEstudio fase 3 de tirzepatida'),
    page(2, 'Tabla de contenidos\n3 Objetivos, criterios de valoración 44\n5.1 Criterios de inclusión 52\n1.3 Cronograma de actividades (SoA) 18'),
    page(18, '1.3 Cronograma de actividades (SoA)\nVisita 1 selección Día -35'),
    page(19, 'Visita 4 Semana 12 Día 85 ± 3 días\nHbA1c, muestra PK'),
    page(20, '2 Introducción\nFundamento del estudio'),
    page(44, '3 Objetivos, criterios de valoración y estimaciones\nObjetivo principal: demostrar superioridad'),
    page(48, '4 Diseño del estudio\nDiseño general'),
    page(52, '5.1 Criterios de inclusión\n1. Adultos mayores de 18 años'),
    page(53, '5.2 Criterios de exclusión\n36. Tienen antecedentes de pancreatitis crónica o aguda.'),
    page(59, '5.3 Consideraciones sobre estilo de vida\nDieta y ejercicio'),
  ]
}

const EMPTY_GROUPS = {
  identification: { identification: { protocolCode: 'J1I-MC-GZBP', title: 'Estudio fase 3', phase: '3', sourcePages: [1] } },
  eligibility: { inclusionCriteria: [], exclusionCriteria: [] },
  endpoints: { endpoints: [] },
  visits: { visits: [] },
}

/** Configura generateObject para responder según el contenido del prompt. */
function mockExtractionByPrompt() {
  mocks.generateObject.mockImplementation(({ prompt }: { prompt: string }) => {
    if (prompt.includes('protocol identification')) {
      return Promise.resolve({ object: EMPTY_GROUPS.identification })
    }
    if (prompt.includes('inclusion criteria')) {
      return Promise.resolve({
        object: {
          inclusionCriteria: [
            { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [52], confidence: 'high' },
          ],
          exclusionCriteria: [
            { number: '36', text: 'Tienen antecedentes de pancreatitis crónica o aguda.', sourcePages: [53], confidence: 'high' },
          ],
        },
      })
    }
    if (prompt.includes('objectives and their endpoints')) {
      return Promise.resolve({
        object: {
          endpoints: [
            { type: 'primary', objective: 'demostrar superioridad', endpoint: 'cambio en HbA1c', sourcePages: [44], confidence: 'high' },
          ],
        },
      })
    }
    if (prompt.includes('schedule of activities')) {
      return Promise.resolve({
        object: {
          visits: [
            { name: 'Visita 4', label: 'Semana 12', day: 85, windowDays: 3, procedures: ['HbA1c', 'muestra PK'], sourcePages: [19], confidence: 'high' },
          ],
        },
      })
    }
    return Promise.reject(new Error(`unexpected prompt: ${prompt.slice(0, 80)}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// locateSection
// ---------------------------------------------------------------------------

describe('locateSection', () => {
  const eligibility = {
    start: /^5\.?1\.?[ \t]+criterios de inclusi[oó]n/im,
    end: /^(?:5\.?3\.?[ \t]+\S|6\.?[ \t]+intervenci)/im,
  }

  it('skips the table of contents and locates the section body (last match wins)', () => {
    const range = locateSection(makeProtocolPages(), eligibility)
    expect(range).toEqual({ pageStart: 52, pageEnd: 59 })
  })

  it('returns null when the start heading does not exist', () => {
    const range = locateSection(makeProtocolPages(), {
      start: /^9\.?\s+sección inexistente/im,
      end: /^10\.?\s+otra/im,
    })
    expect(range).toBeNull()
  })

  it('caps the range at maxPages when the closing heading is missing', () => {
    const pages = [page(10, '5.1 Criterios de inclusión\ntexto')]
    const range = locateSection(pages, eligibility, 5)
    expect(range).toEqual({ pageStart: 10, pageEnd: 14 })
  })

  it('default cap is MAX_SECTION_PAGES', () => {
    const pages = [page(10, '5.1 Criterios de inclusión\ntexto')]
    const range = locateSection(pages, eligibility)
    expect(range).toEqual({ pageStart: 10, pageEnd: 10 + MAX_SECTION_PAGES - 1 })
  })

  it('does not close the range on a bare page-number line ("53\\n") — regression GZBP', () => {
    // El footer "53" seguido de salto de línea NO es el heading 5.3: si el
    // separador fuera \s+ (cruza newlines), la sección se cerraría en p53 y
    // las exclusiones (p54-58) quedarían fuera del contexto del LLM.
    const pages = [
      page(52, '5.1 Criterios de inclusión\n1. Adultos mayores de 18 años'),
      page(53, 'CONFIDENCIAL J11-MC-GZBP\n53\nAprobado el 3 de mayo\n5.2 Criterios de exclusión'),
      page(54, '8. Tienen un cambio autorreportado en el peso corporal'),
      page(59, '5.3 Consideraciones sobre estilo de vida\nDieta y ejercicio'),
    ]
    const range = locateSection(pages, eligibility)
    expect(range).toEqual({ pageStart: 52, pageEnd: 59 })
  })
})

// ---------------------------------------------------------------------------
// buildSectionContext
// ---------------------------------------------------------------------------

describe('buildSectionContext', () => {
  it('marks every page with [PAGE N] so the LLM can report provenance', () => {
    const ctx = buildSectionContext([page(52, 'criterios'), page(53, 'exclusión')])
    expect(ctx).toContain('[PAGE 52]\ncriterios')
    expect(ctx).toContain('[PAGE 53]\nexclusión')
  })
})

// ---------------------------------------------------------------------------
// extractStudySpec
// ---------------------------------------------------------------------------

describe('extractStudySpec', () => {
  it('extracts all four groups and returns a Zod-valid StudySpec without warnings', async () => {
    mockExtractionByPrompt()

    const result = await extractStudySpec(makeProtocolPages())

    expect(result.warnings).toEqual([])
    expect(() => studySpecSchema.parse(result.spec)).not.toThrow()
    expect(result.spec.identification.protocolCode).toBe('J1I-MC-GZBP')
    expect(result.spec.inclusionCriteria).toHaveLength(1)
    expect(result.spec.exclusionCriteria[0]?.number).toBe('36')
    expect(result.spec.endpoints[0]?.type).toBe('primary')
    expect(result.spec.visits[0]?.windowDays).toBe(3)
    expect(mocks.generateObject).toHaveBeenCalledTimes(4)
  })

  it('sends only the located section pages to each group prompt', async () => {
    mockExtractionByPrompt()

    await extractStudySpec(makeProtocolPages())

    const calls = mocks.generateObject.mock.calls as Array<[{ prompt: string; system: string }]>
    const eligibilityCall = calls.find(([arg]) => arg.prompt.includes('inclusion criteria'))?.[0]
    if (!eligibilityCall) throw new Error('eligibility extraction call not found')

    expect(eligibilityCall.system).toBe(SPEC_EXTRACTION_SYSTEM_PROMPT)
    expect(eligibilityCall.prompt).toContain('[PAGE 52]')
    expect(eligibilityCall.prompt).toContain('[PAGE 53]')
    // La sección de elegibilidad no debe incluir el SoA ni la introducción.
    expect(eligibilityCall.prompt).not.toContain('[PAGE 18]')
    expect(eligibilityCall.prompt).not.toContain('[PAGE 2]')
  })

  it('leaves a group empty with a warning when its section heading is not found', async () => {
    mockExtractionByPrompt()
    // Protocolo sin sección de objetivos: ni en el cuerpo ni en el TOC
    // (un protocolo que no tiene la sección tampoco la lista en su índice).
    const pages = makeProtocolPages()
      .filter((p) => p.pageNumber !== 44)
      .map((p) =>
        p.pageNumber === 2
          ? { ...p, rawText: p.rawText.replace('3 Objetivos, criterios de valoración 44\n', '') }
          : p,
      )

    const result = await extractStudySpec(pages)

    expect(result.spec.endpoints).toEqual([])
    expect(result.warnings).toEqual([
      expect.stringContaining('endpoints: section heading not found'),
    ])
    // Los demás grupos no se ven afectados.
    expect(result.spec.inclusionCriteria).toHaveLength(1)
  })

  it('leaves a group empty with a warning when the LLM call fails', async () => {
    mockExtractionByPrompt()
    mocks.generateObject.mockImplementationOnce(() => Promise.reject(new Error('provider down')))

    const result = await extractStudySpec(makeProtocolPages())

    // El primer call (identification, en paralelo) falló — campos null.
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(() => studySpecSchema.parse(result.spec)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// studySpecSchema — contrato
// ---------------------------------------------------------------------------

describe('studySpecSchema', () => {
  it('rejects items without provenance (sourcePages empty)', () => {
    const invalid = {
      identification: { protocolCode: null, title: null, phase: null, sourcePages: [] },
      inclusionCriteria: [{ number: '1', text: 'Adultos', sourcePages: [], confidence: 'high' }],
      exclusionCriteria: [],
      endpoints: [],
      visits: [],
    }
    expect(() => studySpecSchema.parse(invalid)).toThrow()
  })

  it('rejects unknown confidence values', () => {
    const invalid = {
      identification: { protocolCode: null, title: null, phase: null, sourcePages: [] },
      inclusionCriteria: [{ number: '1', text: 'Adultos', sourcePages: [52], confidence: 'certain' }],
      exclusionCriteria: [],
      endpoints: [],
      visits: [],
    }
    expect(() => studySpecSchema.parse(invalid)).toThrow()
  })
})
