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
      run: (
        model: unknown,
        provider: string,
        reportUsage: (u: { inputTokens: number; outputTokens: number }) => void,
      ) => Promise<unknown>,
    ) => {
      // Paso 1 (A7): acumulador real, como el fallback de producción — el
      // total que reporta el runner es el que llega a recordUsage.
      const usage = { inputTokens: 0, outputTokens: 0 }
      const result = await run(mocks.mockModel, 'anthropic', (u) => {
        usage.inputTokens += u.inputTokens
        usage.outputTokens += u.outputTokens
      })
      return {
        result,
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        usage,
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
    // Paso 1 (A7): usage con el shape de ai 7 — cada llamada "gasta" 10/20
    // tokens, para poder afirmar que el consumo llega a recordUsage.
    const usage = { inputTokens: 10, outputTokens: 20 }
    // Semantic locator call — returns page ranges based on which sections are present.
    if (prompt.startsWith('COMPACT PAGE MAP:')) {
      const hasEndpoints = prompt.includes('[P44]')
      return Promise.resolve({
        usage,
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
      return Promise.resolve({ usage, object: EMPTY_GROUPS.identification })
    }
    if (prompt.includes('inclusion criteria')) {
      return Promise.resolve({
        usage,
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
        usage,
        object: {
          endpoints: [
            { type: 'primary', objective: 'demostrar superioridad', endpoint: 'cambio en HbA1c', sourcePages: [44], confidence: 'high' },
          ],
        },
      })
    }
    if (prompt.includes('schedule of activities')) {
      return Promise.resolve({
        usage,
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

  it('registra el consumo con inputTokens > 0 cuando hay usageCtx — mapeo ai 7 (A7)', async () => {
    mockExtractionByPrompt()

    await extractStudySpec(makeProtocolPages(), [], {
      orgId: 'org-1',
      studyId: 'study-1',
      userId: 'user-1',
    })

    // El registro es POR llamada LLM (comportamiento de base): 1 locator + 4
    // grupos = 5 registros, cada uno con los 10/20 tokens de su llamada.
    expect(mocks.recordUsage).toHaveBeenCalledTimes(5)
    let totalInput = 0
    for (const call of mocks.recordUsage.mock.calls) {
      const arg = call[0] as { kind: string; inputTokens: number; outputTokens: number }
      expect(arg.kind).toBe('spec_extraction')
      expect(arg.inputTokens).toBe(10)
      expect(arg.inputTokens).toBeGreaterThan(0)
      expect(arg.outputTokens).toBe(20)
      totalInput += arg.inputTokens
    }
    expect(totalInput).toBe(50)
  })

  it('sends only the located section pages to each group prompt', async () => {
    mockExtractionByPrompt()

    await extractStudySpec(makeProtocolPages())

    const calls = mocks.generateObject.mock.calls as Array<[{ prompt: string; instructions: string }]>
    const eligibilityCall = calls.find(([arg]) => arg.prompt.includes('inclusion criteria'))?.[0]
    if (!eligibilityCall) throw new Error('eligibility extraction call not found')

    expect(eligibilityCall.instructions).toBe(SPEC_EXTRACTION_SYSTEM_PROMPT)
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
    const providerError = Object.assign(new Error('sensitive provider body'), { code: 'rate_limit', status: 429 })
    mocks.generateObject.mockImplementationOnce(() => Promise.reject(providerError))
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await extractStudySpec(makeProtocolPages())

    // El primer call (identification, en paralelo) falló — campos null.
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toContain('extraction_failed: el proveedor no devolvió una respuesta utilizable (código rate_limit)')
    expect(result.warnings.join(' ')).not.toContain('sensitive provider body')
    expect(JSON.stringify(warningLog.mock.calls)).not.toContain('sensitive provider body')
    expect(() => studySpecSchema.parse(result.spec)).not.toThrow()
  })

  it('extracts only visits when given a standalone SoA', async () => {
    mockExtractionByPrompt()

    const result = await extractStudySpec(makeProtocolPages(), [], { visitsOnly: true })

    expect(result.spec.visits).toHaveLength(1)
    expect(result.spec.identification).toEqual({ protocolCode: null, title: null, phase: null, sourcePages: [] })
    expect(result.spec.inclusionCriteria).toEqual([])
    expect(result.spec.exclusionCriteria).toEqual([])
    expect(result.spec.endpoints).toEqual([])
    expect(mocks.generateObject).toHaveBeenCalledTimes(2) // locator + visits, no other groups
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
      expect.stringContaining('duplicate_visit_name'),
      expect.stringContaining('day_order'),
      expect.stringContaining('no_procedures'),
      expect.stringContaining('has an invalid visit window'),
    ]))
    expect(result.warnings.join('\n')).not.toContain('Visita 4')
    expect(result.spec.visits.map((visit) => visit.confidence)).toEqual(['low', 'low'])
    expect(result.spec.visits[1]?.windowDays).toBeNull()
  })

  it('no copia el nombre de la visita (ni un salto de línea) a warnings ni a extractionWarnings', async () => {
    mockExtractionByPrompt()
    const marker = 'PACIENTE_FICTICIO_123_INYECCION_LOG'
    const poisoned = `${marker}\nLINEA_INYECTADA`
    const original = mocks.generateObject.getMockImplementation()!
    mocks.generateObject.mockImplementation((args: { prompt: string }) => {
      if (args.prompt.includes('schedule of activities')) {
        return Promise.resolve({
          object: {
            visits: [
              {
                name: poisoned,
                label: 'Semana 12',
                day: 85,
                windowDays: 3,
                procedures: ['HbA1c'],
                sourcePages: [19],
                confidence: 'high',
              },
              {
                name: poisoned,
                label: 'Semana 2',
                day: 14,
                windowDays: 1,
                procedures: [],
                sourcePages: [19],
                confidence: 'high',
              },
            ],
          },
        })
      }
      return original(args)
    })

    const result = await extractStudySpec(makeProtocolPages())
    const extractionWarnings = result.warnings

    expect(result.spec.visits.some((visit) => visit.name.includes(marker))).toBe(true)
    expect(result.warnings.join('\n')).not.toContain(marker)
    expect(result.warnings.join('\n')).not.toContain('LINEA_INYECTADA')
    expect(extractionWarnings.join('\n')).not.toContain(marker)
    expect(extractionWarnings.join('\n')).not.toContain('LINEA_INYECTADA')
    expect(result.warnings.some((warning) => warning.includes('duplicate_visit_name') && warning.includes('index='))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('\n'))).toBe(false)
  })

  it('does not treat prose "v 12" as a visit label or lower every visit on count mismatch', async () => {
    mockExtractionByPrompt()
    const pages = makeProtocolPages().map((item) =>
      item.pageNumber === 19
        ? { ...item, rawText: `${item.rawText}\nVisit 2, Visit 3; participants v 12 are excluded.` }
        : item,
    )

    const result = await extractStudySpec(pages)

    expect(result.warnings).toContain(
      'visits: extracted visit count (1) is inconsistent with 4 detected visit/time labels',
    )
    expect(result.spec.visits[0]?.confidence).toBe('high')
  })

  // -------------------------------------------------------------------------
  // Regresión E5 (vuelta 4): un tope NUNCA tumba más que el ítem afectado.
  // En 0f441f4 un procedimiento de 601 chars o 101 sourcePages en UNA visita
  // hacían que studySpecSchema.parse (final de extractStudySpec) lanzara
  // ZodError y se perdieran los CUATRO grupos.
  // -------------------------------------------------------------------------

  it('un procedimiento de 601 chars y 101 sourcePages no tumban la extracción (se recortan con advertencia)', async () => {
    mockExtractionByPrompt()
    const original = mocks.generateObject.getMockImplementation()!
    mocks.generateObject.mockImplementation((args: { prompt: string }) => {
      if (args.prompt.includes('schedule of activities')) {
        return Promise.resolve({
          object: {
            visits: [
              {
                name: 'Visita 4',
                label: 'Semana 12',
                day: 85,
                windowDays: 3,
                procedures: ['HbA1c', `procedimiento-largo-${'x'.repeat(580)}`], // 601 chars
                sourcePages: Array.from({ length: 101 }, (_, i) => i + 1),
                confidence: 'high',
              },
              {
                name: 'Visita 1',
                label: 'Selección',
                day: -35,
                windowDays: null,
                procedures: ['Consentimiento'],
                sourcePages: [18],
                confidence: 'high',
              },
            ],
          },
        })
      }
      return original(args)
    })

    const result = await extractStudySpec(makeProtocolPages())

    // La extracción COMPLETA se guarda: criterios, endpoints e identificación
    // intactos (antes: ZodError y nada).
    expect(result.spec.inclusionCriteria).toHaveLength(1)
    expect(result.spec.exclusionCriteria).toHaveLength(1)
    expect(result.spec.endpoints).toHaveLength(1)
    // La visita afectada sobrevive RECORTADA al tope, la válida intacta.
    expect(result.spec.visits).toHaveLength(2)
    expect(result.spec.visits[0]?.procedures[1]).toHaveLength(500)
    expect(result.spec.visits[0]?.sourcePages).toHaveLength(100)
    expect(result.spec.visits[1]?.procedures).toEqual(['Consentimiento'])
    // Una advertencia por ítem recortado, con lo que se ajustó.
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('procedimientos recortados'),
      expect.stringContaining('sourcePages recortadas'),
    ]))
    expect(result.warnings.some((warning) => warning.includes('extraction_failed'))).toBe(false)
  })

  it('un criterio de 10.001 chars no tumba el grupo aunque el SDK lo rechace: se recupera la salida cruda', async () => {
    mockExtractionByPrompt()
    const original = mocks.generateObject.getMockImplementation()!
    const longCriterion = {
      number: '1',
      text: 'Adultos mayores de 18 años '.repeat(371), // 27*371 = 10.017 chars > tope 10.000
      sourcePages: [52],
      confidence: 'high',
    }
    const validCriterion = {
      number: '2',
      text: 'HbA1c entre 7,5% y 10,0%',
      sourcePages: [52],
      confidence: 'high',
    }
    mocks.generateObject.mockImplementation(
      (args: { prompt: string; schema: { safeParse: (value: unknown) => { success: boolean } } }) => {
        if (args.prompt.includes('inclusion criteria')) {
          const object = { inclusionCriteria: [longCriterion, validCriterion], exclusionCriteria: [] }
          // El SDK real (ai 7) valida la salida contra el schema del grupo y
          // lanza NoObjectGeneratedError con .text = JSON crudo del modelo.
          if (!args.schema.safeParse(object).success) {
            const validationError = new Error('No object generated: response did not match schema.')
            validationError.name = 'AI_NoObjectGeneratedError'
            return Promise.reject(Object.assign(validationError, {
              text: JSON.stringify(object),
            }))
          }
          return Promise.resolve({ object })
        }
        return original(args as { prompt: string })
      },
    )

    const result = await extractStudySpec(makeProtocolPages())

    // El grupo NO se pierde (antes: grupo vacío + "provider failure"):
    // el criterio largo se recorta y el válido pasa intacto.
    expect(result.spec.inclusionCriteria).toHaveLength(2)
    expect(result.spec.inclusionCriteria[0]?.text).toHaveLength(10_000)
    expect(result.spec.inclusionCriteria[1]?.text).toBe('HbA1c entre 7,5% y 10,0%')
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('texto recortado'),
    ]))
    expect(result.warnings.some((w) => w.includes('provider failure'))).toBe(false)
  })

  it.each([
    ['autenticación', 'AI_APICallError', 401, 'authentication_error'],
    ['cuota', 'AI_APICallError', 429, 'insufficient_quota'],
    ['transporte', 'TypeError', undefined, 'ECONNRESET'],
  ] as const)(
    'no recupera la salida de un error de %s aunque traiga text, toolInput y cause.value',
    async (_label, name, status, code) => {
      mockExtractionByPrompt()
      const marker = 'MARCADOR_PROVEEDOR_FICTICIO'
      const payload = {
        inclusionCriteria: [
          { number: '1', text: marker, sourcePages: [52], confidence: 'high' },
        ],
        exclusionCriteria: [],
      }
      const original = mocks.generateObject.getMockImplementation()!
      mocks.generateObject.mockImplementation((args: { prompt: string }) => {
        if (args.prompt.includes('inclusion criteria')) {
          const error = new Error(`provider unavailable ${marker}`)
          error.name = name
          error.stack = `stack ${marker}`
          return Promise.reject(Object.assign(error, {
            status,
            code,
            text: JSON.stringify(payload),
            toolInput: JSON.stringify(payload),
            cause: { value: payload },
          }))
        }
        return original(args)
      })

      const result = await extractStudySpec(makeProtocolPages())
      const rendered = JSON.stringify({ spec: result.spec, warnings: result.warnings })

      expect(rendered).not.toContain(marker)
      expect(result.spec.inclusionCriteria).toEqual([])
      expect(result.warnings.some((warning) => warning.includes('fuera de cotas'))).toBe(false)
      expect(result.warnings.some((warning) => warning.includes('extraction_failed'))).toBe(true)
    },
  )

  it('B1: .text recuperado sin exclusionCriteria deja advertencia que nombra la exclusión', async () => {
    mockExtractionByPrompt()
    const original = mocks.generateObject.getMockImplementation()!
    const validCriterion = {
      number: '1',
      text: 'Adultos mayores de 18 años',
      sourcePages: [52],
      confidence: 'high',
    }
    mocks.generateObject.mockImplementation(
      (args: { prompt: string; schema: { safeParse: (value: unknown) => { success: boolean } } }) => {
        if (args.prompt.includes('inclusion criteria')) {
          // El modelo devolvió SOLO inclusión: la exclusión ni vino (y el
          // schema del grupo la exige, así que el SDK rechaza).
          const object = { inclusionCriteria: [validCriterion] }
          if (!args.schema.safeParse(object).success) {
            const validationError = new Error('No object generated: response did not match schema.')
            validationError.name = 'AI_NoObjectGeneratedError'
            return Promise.reject(Object.assign(validationError, {
              text: JSON.stringify(object),
            }))
          }
          return Promise.resolve({ object })
        }
        return original(args as { prompt: string })
      },
    )

    const result = await extractStudySpec(makeProtocolPages())

    // La inclusión se recupera; la exclusión queda vacía PERO nombrada —
    // no se lee como "este protocolo no tiene criterios de exclusión".
    expect(result.spec.inclusionCriteria).toHaveLength(1)
    expect(result.spec.exclusionCriteria).toEqual([])
    expect(result.warnings.some((w) => w.includes('exclusion') && w.includes('ausente'))).toBe(true)
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
