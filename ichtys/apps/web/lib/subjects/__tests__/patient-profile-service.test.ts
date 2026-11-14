import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PHI_IN_ERROR =
  'invalid JSON: {"ageYears":58,"labs":[{"name":"HbA1c","value":8.2}]} — paciente Juan Pérez, DNI 30.111.222'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  auditInsert: vi.fn(async () => undefined),
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
  // Estas pruebas miran el registro de errores y el consumo, no la validación del perfil
  // (eso está en patient-profile-guard.test.ts): el esquema deja pasar lo que recibe.
  patientProfileSchema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: { patientProfiles: { findFirst: mocks.findFirst } },
    // El perfil y su registro de auditoría entran por la transacción.
    transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        update: () => ({
          set: (values: unknown) => {
            mocks.updateSet(values)
            return { where: mocks.updateWhere }
          },
        }),
        insert: () => ({ values: mocks.auditInsert }),
      }),
  },
  auditLogs: {},
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
  decryptStoredProfile: mocks.decryptProfileJson,
}))

import { llmFactsSchema, proposeProfileFromEvolution } from '../patient-profile-service'

const PARAMS = {
  orgId: crypto.randomUUID(),
  studyId: crypto.randomUUID(),
  subjectId: crypto.randomUUID(),
  evolutionId: crypto.randomUUID(),
  evolutionContent: 'Paciente Juan Pérez, HbA1c 8.2%.',
  userId: 'user_author',
}

describe('proposeProfileFromEvolution — logging del error del proveedor', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue({ profileEncrypted: 'encrypted', updatedAt: new Date() })
    mocks.updateWhere.mockReturnValue({ returning: async () => [{ subjectId: 'subject' }] })
    mocks.extractFactsFromEvolution.mockReturnValue({ labs: [] })
    // La extracción encontró un dato: hay algo que proponer.
    mocks.mergeExtractions.mockReturnValue({ facts: { labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }], medications: [], conditions: [] }, fieldConfidence: { labs: { hba1c: 'medium' } } })
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

    const result = await proposeProfileFromEvolution(PARAMS)

    // La extracción con modelo falló, pero lo que encontraron las reglas queda
    // como propuesta. Nada de eso entra a los datos del perfil (R6).
    expect(result).toEqual({ factCount: 1 })
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1)
    expect(mocks.mergeProfileWithExtraction).not.toHaveBeenCalled()
    const written = (mocks.encryptProfileJson.mock.calls as unknown as unknown[][]).at(-1)?.[0] as { labs: unknown[]; pendingEvolutionProposals: Array<Record<string, unknown>> }
    expect(written.labs).toEqual([])
    expect(written.pendingEvolutionProposals).toEqual([
      expect.objectContaining({ requiresHumanReview: true, evolutionId: PARAMS.evolutionId, facts: expect.objectContaining({ labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }] }) }),
    ])

    // El registro dice lo que pasó: una propuesta automática, sin confirmar, y
    // sin valores ni texto clínico.
    expect(mocks.auditInsert).toHaveBeenCalledTimes(1)
    expect(mocks.auditInsert).toHaveBeenCalledWith({
      action: 'profile.proposal.create',
      organizationId: PARAMS.orgId,
      studyId: PARAMS.studyId,
      userId: 'user_author',
      resourceType: 'subject',
      resourceId: PARAMS.subjectId,
      metadata: { source: 'evolution_extraction', evolutionId: PARAMS.evolutionId, automated: true, humanConfirmed: false, factCount: 1 },
    })
    expect(JSON.stringify(mocks.auditInsert.mock.calls)).not.toContain('HbA1c')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toContain('[clinical-extract] LLM extraction failed:')
    expect(logged).toContain('APICallError')
    expect(logged).toContain('status 500')
    expect(logged).not.toContain('Juan Pérez')
    expect(logged).not.toContain('30.111.222')
    expect(logged).not.toContain('HbA1c')
  })

  it('la lectura de evoluciones con modelo va solo a Anthropic: sin respaldo en otro proveedor', async () => {
    // AI-GOVERNANCE.md registra un solo proveedor para esta función y R6 exige
    // evaluar antes de cambiarlo. Con preferencia explícita la cadena es de uno:
    // si Anthropic no responde, el texto clínico no sale hacia otro proveedor.
    mocks.runWithLlmFallback.mockRejectedValue(new TypeError('x'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await proposeProfileFromEvolution({ orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1', userId: 'user-1', evolutionId: 'evo-1', evolutionContent: 'Paciente de 52 años.' })
    } finally {
      spy.mockRestore()
    }
    expect(mocks.runWithLlmFallback).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'clinical-extract', providerPreference: 'anthropic' }), expect.any(Function))
  })

  it('si no se encontró ningún dato, no se propone ni se escribe nada', async () => {
    mocks.runWithLlmFallback.mockRejectedValue(new TypeError('x'))
    mocks.mergeExtractions.mockReturnValue({ facts: { labs: [], medications: [], conditions: [] }, fieldConfidence: {} })

    expect(await proposeProfileFromEvolution(PARAMS)).toEqual({ factCount: 0 })
    expect(mocks.updateWhere).not.toHaveBeenCalled()
    expect(mocks.auditInsert).not.toHaveBeenCalled()
  })

  it('acepta el campo status (no solo statusCode) de otros proveedores', async () => {
    mocks.runWithLlmFallback.mockRejectedValue(
      Object.assign(new Error('rate limited: prompt was ...'), { name: 'RateLimitError', status: 429 }),
    )

    await proposeProfileFromEvolution(PARAMS)

    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toBe('[clinical-extract] LLM extraction failed: RateLimitError (status 429)')
  })

  it('con un error sin status loguea solo el nombre de la clase', async () => {
    mocks.runWithLlmFallback.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await proposeProfileFromEvolution(PARAMS)

    const logged = errorSpy.mock.calls[0]!.map((part) => String(part)).join(' ')
    expect(logged).toBe('[clinical-extract] LLM extraction failed: TypeError')
  })
})

describe('proposeProfileFromEvolution — medición de consumo (A7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue({ profileEncrypted: 'encrypted', updatedAt: new Date() })
    mocks.updateWhere.mockReturnValue({ returning: async () => [{ subjectId: 'subject' }] })
    mocks.extractFactsFromEvolution.mockReturnValue({ labs: [] })
    // La extracción encontró un dato: hay algo que proponer.
    mocks.mergeExtractions.mockReturnValue({ facts: { labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }], medications: [], conditions: [] }, fieldConfidence: { labs: { hba1c: 'medium' } } })
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

    await proposeProfileFromEvolution(PARAMS)

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
