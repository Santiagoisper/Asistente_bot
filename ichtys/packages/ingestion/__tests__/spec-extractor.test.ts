import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

// ---------------------------------------------------------------------------
// Mocks hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockModel = Symbol('mock-anthropic-model')
  return {
    mockModel,
    anthropicProviderFn: vi.fn().mockReturnValue(mockModel),
    generateObject: vi.fn(),
    recordUsage: vi.fn(),
  }
})

vi.mock('@ichtys/llm', () => ({
  runWithLlmFallback: vi.fn(
    async (
      _opts: unknown,
      run: (model: unknown, provider: string, reportUsage: (u: unknown) => void) => Promise<unknown>,
    ) => {
      const result = await run(mocks.mockModel, 'anthropic', () => {})
      return {
        result,
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        usage: { inputTokens: 0, outputTokens: 0 },
        keySource: 'platform',
      }
    },
  ),
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))

// @ichtys/db: mock minimal — spec-extractor.ts llama a recordUsage para medir consumo.
vi.mock('@ichtys/db', () => ({
  recordUsage: mocks.recordUsage,
}))

import {
  buildSectionContext,
  extractStudySpec,
  samplePageTextForMap,
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
    // Semantic locator call — returns page ranges based on which sections are present.
    if (prompt.startsWith('COMPACT PAGE MAP:')) {
      const hasEndpoints = prompt.includes('[P44]')
      return Promise.resolve({
        object: {
          identification: { pageStart: 1, pageEnd: 2 },
          eligibility: { pageStart: 52, pageEnd: 59 },
          endpoints: hasEndpoints ? { pageStart: 44, pageEnd: 48 } : { pageStart: null, pageEnd: null },
          visits: { pageStart: 18, pageEnd: 20 },
          detectedLanguage: 'es',
        },
      })
    }
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
    if (prompt.includes('objectives and their') && prompt.includes('endpoints')) {
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
    // 1 semantic-locator call + 4 extraction group calls
    expect(mocks.generateObject).toHaveBeenCalledTimes(5)
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
      expect.stringContaining('endpoints: section not located by semantic locator'),
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

  it('sends a cropped PDF for the located SoA range and preserves source page numbers', async () => {
    mockExtractionByPrompt()
    const original = mocks.generateObject.getMockImplementation()!
    const pdfPageCounts: number[] = []
    mocks.generateObject.mockImplementation(async (args: {
      prompt?: string
      messages?: Array<{ content: Array<{ type: string; data?: Uint8Array; text?: string }> }>
    }) => {
      const content = args.messages?.[0]?.content
      const file = content?.find((part) => part.type === 'file')
      if (file?.data) pdfPageCounts.push((await PDFDocument.load(file.data)).getPageCount())
      const prompt = args.prompt ?? content?.find((part) => part.type === 'text')?.text
      return original({ prompt } as never)
    })

    const source = await PDFDocument.create()
    for (let i = 0; i < 60; i += 1) source.addPage()
    const result = await extractStudySpec(makeProtocolPages(), [], { protocolPdf: await source.save() })

    expect(pdfPageCounts.sort((a, b) => a - b)).toEqual([3, 8])
    expect(result.warnings).toEqual([])
    const calls = mocks.generateObject.mock.calls as Array<[{ messages?: Array<{ content: Array<{ type: string; text?: string }> }> }]>
    const visitCall = calls.find(([arg]) => arg.messages?.[0]?.content.some((part) => part.type === 'file'))?.[0]
    expect(visitCall?.messages?.[0]?.content.find((part) => part.type === 'text')?.text).toContain('Use [PAGE N] below for sourcePages')
  })

  it('warns and lowers confidence for duplicate or out-of-order visits', async () => {
    mockExtractionByPrompt()
    const original = mocks.generateObject.getMockImplementation()!
    mocks.generateObject.mockImplementation((args: { prompt: string }) => {
      if (args.prompt.includes('schedule of activities')) {
        return Promise.resolve({
          object: {
            visits: [
              { name: 'Visita 4', label: 'Semana 12', day: 85, windowDays: 3, procedures: ['HbA1c'], sourcePages: [19], confidence: 'high' },
              { name: 'Visita 4', label: 'Semana 2', day: 14, windowDays: -2, procedures: [], sourcePages: [19], confidence: 'high' },
            ],
          },
        })
      }
      return original(args)
    })

    const result = await extractStudySpec(makeProtocolPages())

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate visit name'),
      expect.stringContaining('not ordered by day'),
      expect.stringContaining('has no procedures'),
      expect.stringContaining('has an invalid visit window'),
    ]))
    expect(result.spec.visits.map((visit) => visit.confidence)).toEqual(['low', 'low'])
    expect(result.spec.visits[1]?.windowDays).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// samplePageTextForMap — headers repetidos (Sanofi, etc.)
// ---------------------------------------------------------------------------

describe('samplePageTextForMap', () => {
  it('salta header Sanofi repetido y expone contenido de sección', () => {
    const header =
      'Protocolo de ensayo clínico SAR231893 - EFC18365 - dupilumab 26 - JUL - 2024 Versión número: 1 Propiedad de Grupo Sanofi; estrictamente confidencial Página 37 '
    const body = 'Afecciones médicas E 01. Participantes con diagnóstico de lesiones activas'
    const snippet = samplePageTextForMap(header + body, 37)
    expect(snippet).toContain('Afecciones médicas')
    expect(snippet).not.toMatch(/^Protocolo de ensayo/)
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
