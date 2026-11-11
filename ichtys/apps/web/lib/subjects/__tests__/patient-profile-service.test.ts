import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PHI_IN_ERROR =
  'invalid JSON: {"ageYears":58,"labs":[{"name":"HbA1c","value":8.2}]} — paciente Juan Pérez, DNI 30.111.222'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  getOrgLlmApiKeys: vi.fn(async () => ({})),
  recordUsage: vi.fn(async () => undefined),
  runWithLlmFallback: vi.fn(),
  extractFactsFromEvolution: vi.fn(),
  redactPhiForLlm: vi.fn((text: string) => ({ text, replaced: [] })),
  mergeExtractions: vi.fn(),
  mergeProfileWithExtraction: vi.fn(),
  encryptProfileJson: vi.fn(() => 'encrypted'),
  decryptProfileJson: vi.fn(() => ({ version: 1, labs: [], medications: [], conditions: [] })),
}))

vi.mock('@ichtys/clinical', () => ({
  extractFactsFromEvolution: mocks.extractFactsFromEvolution,
  redactPhiForLlm: mocks.redactPhiForLlm,
  mergeExtractions: mocks.mergeExtractions,
  mergeProfileWithExtraction: mocks.mergeProfileWithExtraction,
  parsePatientProfile: vi.fn((value: unknown) => value),
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: { patientProfiles: { findFirst: mocks.findFirst } },
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values)
        return { where: mocks.updateWhere }
      },
    }),
  },
  and: (...args: unknown[]) => args,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  getOrgLlmApiKeys: mocks.getOrgLlmApiKeys,
  recordUsage: mocks.recordUsage,
  patientProfiles: { organizationId: 'org', studyId: 'study', subjectId: 'subject' },
}))

vi.mock('@ichtys/llm', () => ({
  runWithLlmFallback: mocks.runWithLlmFallback,
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('../profile-version', () => ({ whereProfileUnchanged: () => ({}), nextVersion: () => new Date() }))

vi.mock('../phi-fields', () => ({
  encryptProfileJson: mocks.encryptProfileJson,
  decryptProfileJson: mocks.decryptProfileJson,
}))

import { llmFactsSchema, refreshPatientProfileFromEvolution } from '../patient-profile-service'

const PARAMS = {
  orgId: crypto.randomUUID(),
  studyId: crypto.randomUUID(),
  subjectId: crypto.randomUUID(),
  evolutionId: crypto.randomUUID(),
  evolutionContent: 'Paciente Juan Pérez, HbA1c 8.2%.',
}

describe('refreshPatientProfileFromEvolution — logging del error del proveedor', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue({ profileEncrypted: 'encrypted', updatedAt: new Date() })
    mocks.updateWhere.mockReturnValue({ returning: async () => [{ subjectId: 'subject' }] })
    mocks.extractFactsFromEvolution.mockReturnValue({ labs: [] })
    mocks.mergeExtractions.mockReturnValue({ labs: [] })
    mocks.mergeProfileWithExtraction.mockReturnValue({ version: 1, labs: [], medications: [], conditions: [] })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('no loguea el mensaje del proveedor (puede traer texto clínico) y sí el status', async () => {
    const providerError = Object.assign(new Error(PHI_IN_ERROR), {
      name: 'APICallError',
      statusCode: 500,
    })
    mocks.runWithLlmFallback.mockRejectedValue(providerError)

    const profile = await refreshPatientProfileFromEvolution(PARAMS)

    // La extracción fallida no rompe el flujo: se guarda el perfil heurístico.
    expect(profile).toMatchObject({ version: 1 })
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toContain('[clinical-extract] LLM extraction failed:')
    expect(logged).toContain('APICallError')
    expect(logged).toContain('status 500')
    expect(logged).not.toContain('Juan Pérez')
    expect(logged).not.toContain('30.111.222')
    expect(logged).not.toContain('HbA1c')
  })

  it('acepta el campo status (no solo statusCode) de otros proveedores', async () => {
    mocks.runWithLlmFallback.mockRejectedValue(
      Object.assign(new Error('rate limited: prompt was ...'), { name: 'RateLimitError', status: 429 }),
    )

    await refreshPatientProfileFromEvolution(PARAMS)

    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toBe('[clinical-extract] LLM extraction failed: RateLimitError (status 429)')
  })

  it('con un error sin status loguea solo el nombre de la clase', async () => {
    mocks.runWithLlmFallback.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await refreshPatientProfileFromEvolution(PARAMS)

    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toBe('[clinical-extract] LLM extraction failed: TypeError')
  })
})

describe('refreshPatientProfileFromEvolution — medición de consumo (A7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue({ profileEncrypted: 'encrypted', updatedAt: new Date() })
    mocks.updateWhere.mockReturnValue({ returning: async () => [{ subjectId: 'subject' }] })
    mocks.extractFactsFromEvolution.mockReturnValue({ labs: [] })
    mocks.mergeExtractions.mockReturnValue({ labs: [] })
    mocks.mergeProfileWithExtraction.mockReturnValue({ version: 1, labs: [], medications: [], conditions: [] })
  })

  it('registra el consumo del extractor clínico con inputTokens > 0 — mapeo ai 7', async () => {
    // Acumulador real (como el fallback de producción): el total que reporta
    // el runner es el que llega a recordUsage.
    mocks.runWithLlmFallback.mockImplementation(async (_cfg, runner) => {
      const usage = { inputTokens: 0, outputTokens: 0 }
      const reportUsage = (u: { inputTokens: number; outputTokens: number }) => {
        usage.inputTokens += u.inputTokens
        usage.outputTokens += u.outputTokens
      }
      const result = await runner({} as never, 'anthropic', reportUsage, undefined as never)
      return { result, provider: 'anthropic', modelId: 'claude-sonnet-4-6', usage, keySource: 'org' }
    })
    const { generateObject } = await import('ai')
    // El result de ai 7 trae más campos (finishReason, response, ...) que este
    // test no usa — el código solo lee .object y .usage. Usage va con el shape
    // completo de LanguageModelUsage (totalTokens + detalles).
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { ageYears: 58, labs: [], medications: [], conditions: [] },
      usage: {
        inputTokens: 7,
        outputTokens: 5,
        totalTokens: 12,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    } as never)

    await refreshPatientProfileFromEvolution(PARAMS)

    expect(mocks.recordUsage).toHaveBeenCalledTimes(1)
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'clinical_extraction', inputTokens: 7, outputTokens: 5 }),
    )
  })

  it('llmFactsSchema se mantiene chico: ≤ 10 campos (presupuesto de tokens del extractor clínico)', () => {
    // Cada campo opcional extra infla el schema que viaja en cada llamada
    // sobre texto clínico redactado — tope duro de 10.
    expect(Object.keys(llmFactsSchema.shape).length).toBeLessThanOrEqual(10)
  })
})
