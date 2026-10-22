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

vi.mock('../phi-fields', () => ({
  encryptProfileJson: mocks.encryptProfileJson,
  decryptProfileJson: mocks.decryptProfileJson,
}))

import { refreshPatientProfileFromEvolution } from '../patient-profile-service'

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
    mocks.findFirst.mockResolvedValue(null)
    mocks.updateWhere.mockResolvedValue(undefined)
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
