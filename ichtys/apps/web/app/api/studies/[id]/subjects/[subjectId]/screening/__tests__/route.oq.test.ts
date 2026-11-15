/**
 * OQ — screening GET determinista (CSV Etapa 2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }

  const ORG_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()
  const SUBJECT_ID = crypto.randomUUID()
  const USER_ID = 'user_oq_test'
  const SNAPSHOT_ID = crypto.randomUUID()

  const mockProfile = {
    version: 1 as const,
    labs: [{ name: 'HbA1c', value: 9.0, unit: '%' }],
    medications: [],
    conditions: [] as string[],
  }

  const mockEvaluation = {
    assessments: [
      {
        criterionNumber: '3',
        criterionText: 'HbA1c 7.0-10.0%',
        kind: 'inclusion' as const,
        status: 'pass' as const,
        reason: 'HbA1c 9% dentro del rango.',
        sourcePages: [12],
      },
    ],
    summary: { pass: 1, fail: 0, unknown: 0 },
    specVersion: 1,
    protocolDocumentId: 'doc-version-1',
    persistedSnapshotId: SNAPSHOT_ID,
  }

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    SNAPSHOT_ID,
    mockProfile,
    mockEvaluation,
    validateSubjectAccess: vi.fn(),
    handleApiError: vi
      .fn<(err: unknown) => Response>()
      .mockImplementation((err: unknown) => {
        if (err instanceof MockAccessError) {
          const msg =
            err.status === 401 ? 'Unauthorized' : err.status === 403 ? 'Forbidden' : 'Not Found'
          return new Response(msg, { status: err.status })
        }
        return new Response('Internal Server Error', { status: 500 })
      }),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    loadPatientProfile: vi.fn(),
    getLatestStudySpec: vi.fn(),
    getLatestSpecAttempt: vi.fn(),
    evaluateAndPersistScreening: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('@ichtys/ingestion/spec-store', () => ({
  getLatestStudySpec: mocks.getLatestStudySpec,
  getLatestSpecAttempt: mocks.getLatestSpecAttempt,
}))

vi.mock('../../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../../../lib/subjects/patient-profile-service', () => ({
  loadPatientProfileState: mocks.loadPatientProfile,
}))

vi.mock('../../../../../../../../lib/subjects/screening-service', () => ({
  evaluateAndPersistScreening: mocks.evaluateAndPersistScreening,
}))

vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({
  PhiConfigError: class PhiConfigError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PhiConfigError'
    }
  },
}))

import { GET } from '../route'

const VALID_SPEC = {
  identification: {
    protocolCode: 'MOCK-001',
    title: 'Mock protocol',
    phase: '2b',
    sourcePages: [1],
  },
  inclusionCriteria: [
    {
      number: '3',
      text: 'HbA1c >= 7.0% and <= 10.0%',
      sourcePages: [12],
      confidence: 'high' as const,
    },
  ],
  exclusionCriteria: [],
  endpoints: [],
  visits: [],
}

function makeParams(subjectId = mocks.SUBJECT_ID) {
  return { params: Promise.resolve({ id: mocks.STUDY_ID, subjectId }) }
}

function subjectContext() {
  return {
    orgId: mocks.ORG_ID,
    userId: mocks.USER_ID,
    study: { id: mocks.STUDY_ID },
    subject: {
      id: mocks.SUBJECT_ID,
      subjectCode: 'MOCK-001',
      studyId: mocks.STUDY_ID,
      organizationId: mocks.ORG_ID,
    },
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('OQ-SCR01 — screening sin autenticación', () => {
  it('GET devuelve 401', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())

    expect(res.status).toBe(401)
    expect(mocks.getLatestStudySpec).not.toHaveBeenCalled()
  })
})

describe('OQ-SCR02 — screening cross-org', () => {
  it('GET devuelve 404', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())

    expect(res.status).toBe(404)
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })
})

describe('OQ-SCR03 — sin spec en DB', () => {
  it('GET devuelve specAvailable false y assessments vacíos', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable: false })
    mocks.getLatestStudySpec.mockResolvedValueOnce(null)

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())
    const body = (await res.json()) as {
      specAvailable: boolean
      assessments: unknown[]
      summary: { pass: number; fail: number; unknown: number }
    }

    expect(res.status).toBe(200)
    expect(body.specAvailable).toBe(false)
    expect(body.assessments).toEqual([])
    expect(body.summary).toEqual({ pass: 0, fail: 0, unknown: 0 })
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })
})

describe('OQ-SCR04 — con spec mock', () => {
  it('GET devuelve specAvailable true y assessments del service', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable: false })
    mocks.getLatestStudySpec.mockResolvedValueOnce({
      version: 1,
      status: 'approved',
      documentVersionId: 'doc-v1',
      spec: VALID_SPEC,
    })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())
    const body = (await res.json()) as {
      specAvailable: boolean
      assessments: Array<{ status: string }>
      summary: { pass: number }
    }

    expect(res.status).toBe(200)
    expect(body.specAvailable).toBe(true)
    expect(body.assessments).toHaveLength(1)
    expect(body.assessments[0]?.status).toBe('pass')
    expect(body.summary.pass).toBe(1)
    expect(mocks.evaluateAndPersistScreening).toHaveBeenCalledTimes(1)
  })
})

describe('OQ-SCR05 — audit screening.view sin PHI', () => {
  it('metadata solo pass/fail/unknown/snapshotId y si se guardó una instantánea', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable: false })
    mocks.getLatestStudySpec.mockResolvedValueOnce({
      version: 1,
      status: 'approved',
      documentVersionId: 'doc-v1',
      spec: VALID_SPEC,
    })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    await GET(new Request('http://localhost/api/screening'), makeParams())

    // El registro lo escribe el servicio (junto con la instantánea si guarda una);
    // la ruta le entrega cómo armarlo. Acá se verifica qué arma.
    const params = mocks.evaluateAndPersistScreening.mock.calls[0]?.[0] as {
      audit: (facts: { summary: { pass: number; fail: number; unknown: number }; snapshotId: string | null; snapshotCreated: boolean }) => {
        action: string
        resourceId: string
        metadata?: Record<string, unknown>
      }
    }
    const auditCall = params.audit({ summary: { pass: 1, fail: 0, unknown: 0 }, snapshotId: mocks.SNAPSHOT_ID, snapshotCreated: true })
    expect(auditCall).toEqual(
      expect.objectContaining({
        action: 'screening.view',
        resourceId: mocks.SUBJECT_ID,
        metadata: { pass: 1, fail: 0, unknown: 0, snapshotId: mocks.SNAPSHOT_ID, snapshotCreated: true },
      }),
    )
    // La ruta ya no registra por su cuenta: no puede haber dos registros de la misma consulta.
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
    const metadataJson = JSON.stringify(auditCall.metadata)
    expect(metadataJson).not.toContain('HbA1c')
    expect(metadataJson).not.toContain('criterionText')
  })
})

describe('OQ-SCR06 — screening determinista (no LLM)', () => {
  it('usa evaluateAndPersistScreening (rule engine), no generación LLM', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable: false })
    mocks.getLatestStudySpec.mockResolvedValueOnce({
      version: 1,
      status: 'approved',
      documentVersionId: 'doc-v1',
      spec: VALID_SPEC,
    })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    await GET(new Request('http://localhost/api/screening'), makeParams())

    expect(mocks.evaluateAndPersistScreening).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: mocks.ORG_ID,
        studyId: mocks.STUDY_ID,
        subjectId: mocks.SUBJECT_ID,
        profile: mocks.mockProfile,
      }),
    )
  })
})

describe('S4 — screening compara el estudio de la URL', () => {
  it('pasa el id de la URL antes de evaluar', async () => {
    const otherStudyId = crypto.randomUUID()
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())

    await GET(new Request('http://localhost/api/screening'), {
      params: Promise.resolve({ id: otherStudyId, subjectId: mocks.SUBJECT_ID }),
    })

    expect(mocks.validateSubjectAccess).toHaveBeenCalledWith(mocks.SUBJECT_ID, otherStudyId)
  })
})

describe('perfil guardado que no se pudo leer', () => {
  it('lo dice, no evalúa la elegibilidad y no guarda ninguna instantánea', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: { version: 1, labs: [], medications: [], conditions: [] }, unreadable: true })
    mocks.getLatestStudySpec.mockResolvedValueOnce({ version: 1, status: 'approved', documentVersionId: 'doc-v1', spec: VALID_SPEC })

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())
    const body = (await res.json()) as { profileUnreadable: boolean; assessments: unknown[]; summary: unknown; specAvailable: boolean }

    expect(res.status).toBe(200)
    expect(body.profileUnreadable).toBe(true)
    expect(body.assessments).toEqual([])
    expect(body.summary).toEqual({ pass: 0, fail: 0, unknown: 0 })
    expect(body.specAvailable).toBe(true)
    // Evaluar un perfil vacío dejaría guardada una evaluación falsa, con todo «a revisar».
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })

  it('un perfil legible responde profileUnreadable en falso', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable: false })
    mocks.getLatestStudySpec.mockResolvedValueOnce({ version: 1, status: 'approved', documentVersionId: 'doc-v1', spec: VALID_SPEC })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    const res = await GET(new Request('http://localhost/api/screening'), makeParams())
    expect(((await res.json()) as { profileUnreadable: boolean }).profileUnreadable).toBe(false)
  })
})

describe('C5 — la elegibilidad exige un protocolo aprobado', () => {
  afterEach(() => {
    mocks.getLatestStudySpec.mockReset()
    mocks.getLatestSpecAttempt.mockReset()
  })
  const SPEC_WITH_VISIT = {
    ...VALID_SPEC,
    visits: [{ name: 'Visita 1', label: 'Semana 0', day: 0, windowDays: null, procedures: ['Signos vitales'], sourcePages: [20], confidence: 'high' as const }],
  }
  const draft = (version: number, spec: unknown = SPEC_WITH_VISIT) => ({ version, status: 'draft', documentVersionId: `doc-v${version}`, spec })
  const approved = (version: number) => ({ version, status: 'approved', documentVersionId: `doc-v${version}`, spec: VALID_SPEC })
  const arrange = (unreadable = false) => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable })
  }
  /**
   * Responde según lo que se le pide: el aprobado, el último útil o el último intento. Así un
   * cambio de `approvedOnly` o de la consulta del aviso se nota.
   */
  const store = (rows: { approved: unknown; latest: unknown; attempt?: unknown }) => {
    mocks.getLatestStudySpec.mockImplementation(async (params: { approvedOnly?: boolean }) => (params.approvedOnly ? rows.approved : rows.latest))
    mocks.getLatestSpecAttempt.mockImplementation(async () => (rows.attempt === undefined ? rows.latest : rows.attempt))
  }
  const evaluated = (specVersion: number) =>
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce({ assessments: [], summary: { pass: 0, fail: 0, unknown: 0 }, specVersion, protocolDocumentId: null })
  const get = async () => (await (await GET(new Request('http://localhost/api/screening'), makeParams())).json()) as Record<string, unknown>

  it('pide el protocolo aprobado, no el último', async () => {
    arrange()
    store({ approved: null, latest: draft(1) })
    await get()
    expect(mocks.getLatestStudySpec.mock.calls[0]![0]).toMatchObject({ approvedOnly: true })
  })

  it('solo hay un borrador: no evalúa, no guarda instantánea y dice que espera aprobación', async () => {
    arrange()
    store({ approved: null, latest: draft(2) })
    const body = await get()

    expect(body.specAvailable).toBe(false)
    expect(body.specPendingApproval).toBe(true)
    expect(body.pendingSpecVersion).toBe(2)
    expect(body.assessments).toEqual([])
    expect(String(body.message)).toContain('no fue aprobado')
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })

  it('solo hay un borrador: el cronograma sale para la guía, marcado como de borrador', async () => {
    arrange()
    store({ approved: null, latest: draft(2) })
    const body = await get()
    expect(body.visitsFromDraft).toBe(true)
    expect(Array.isArray(body.visits)).toBe(true)
    expect((body.visits as unknown[]).length).toBe(1)
  })

  it('el borrador nuevo no trae visitas y lo último útil es una versión reemplazada: no entrega las de la reemplazada', async () => {
    arrange()
    const partial = draft(3, { identification: VALID_SPEC.identification, inclusionCriteria: [], exclusionCriteria: [], endpoints: [], visits: [] })
    store({ approved: null, latest: { ...draft(2), status: 'superseded' }, attempt: partial })
    const body = await get()
    expect(body.specPendingApproval).toBe(true)
    expect(body.pendingSpecVersion).toBe(3)
    expect(body.visits).toBeUndefined()
    expect(body.visitsFromDraft).toBeUndefined()
  })

  it('no hay nada extraído: no dice que algo espera aprobación ni entrega visitas', async () => {
    arrange()
    store({ approved: null, latest: null })
    const body = await get()
    expect(body.specAvailable).toBe(false)
    expect(body.specPendingApproval).toBe(false)
    expect(body.pendingSpecVersion).toBeNull()
    expect(body.visits).toBeUndefined()
    expect(body.visitsFromDraft).toBeUndefined()
  })

  it('aprobado y un borrador más nuevo: evalúa con el aprobado, avisa del borrador y las visitas no son de borrador', async () => {
    arrange()
    store({ approved: approved(1), latest: draft(2) })
    evaluated(1)
    const body = await get()

    expect(body.specAvailable).toBe(true)
    expect(body.specStatus).toBe('approved')
    expect(body.specPendingApproval).toBe(true)
    expect(body.pendingSpecVersion).toBe(2)
    expect(body.visitsFromDraft).toBeUndefined()
    expect(mocks.evaluateAndPersistScreening.mock.calls.at(-1)![0]).toMatchObject({ specVersion: 1, documentVersionId: 'doc-v1' })
  })

  it('aprobado y nada más nuevo: no avisa de ningún borrador', async () => {
    arrange()
    store({ approved: approved(3), latest: approved(3) })
    evaluated(3)
    expect((await get()).specPendingApproval).toBe(false)
  })

  it('un borrador nuevo que solo trae la identificación también espera aprobación', async () => {
    // «El último útil» sigue siendo el aprobado; el aviso mira el último intento.
    arrange()
    const partial = draft(2, { identification: VALID_SPEC.identification, inclusionCriteria: [], exclusionCriteria: [], endpoints: [], visits: [] })
    store({ approved: approved(1), latest: approved(1), attempt: partial })
    evaluated(1)
    const body = await get()
    expect(body.specPendingApproval).toBe(true)
    expect(body.pendingSpecVersion).toBe(2)
  })

  it('una extracción fallida más nueva no espera aprobación', async () => {
    arrange()
    const failed = draft(2, { ...VALID_SPEC, extractionFailed: true })
    store({ approved: approved(1), latest: approved(1), attempt: failed })
    evaluated(1)
    expect((await get()).specPendingApproval).toBe(false)
  })

  it('con el perfil ilegible sigue diciendo qué versión espera aprobación', async () => {
    arrange(true)
    store({ approved: approved(1), latest: draft(2) })
    const body = await get()
    expect(body.profileUnreadable).toBe(true)
    expect(body.specPendingApproval).toBe(true)
    expect(body.pendingSpecVersion).toBe(2)
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })
})

/**
 * Hallazgo de revisión del #195: cuando la ruta no evalúa, igual entrega el perfil del sujeto,
 * y la ficha lee el perfil solo por acá. Esa lectura tiene que dejar su registro, como lo deja
 * `profile.view`. Antes del #195 un estudio con solo borrador pasaba por la evaluación y dejaba
 * `screening.view`; desde C5 esa rama no evalúa.
 */
describe('toda consulta que entrega el perfil deja un registro de acceso', () => {
  afterEach(() => {
    mocks.getLatestStudySpec.mockReset()
    mocks.getLatestSpecAttempt.mockReset()
    mocks.writeAuditLog.mockReset()
    mocks.writeAuditLog.mockResolvedValue(undefined)
  })
  // Identificador con letras y dato del perfil reconocible: el registro no puede traer ninguno de los dos valores clínicos.
  const draft = (version: number) => ({ version, status: 'draft', documentVersionId: `doc-v${version}`, spec: VALID_SPEC })
  const approved = (version: number, spec: unknown = VALID_SPEC) => ({ version, status: 'approved', documentVersionId: `doc-v${version}`, spec })
  const store = (rows: { approved: unknown; latest: unknown }) => {
    mocks.getLatestStudySpec.mockImplementation(async (params: { approvedOnly?: boolean }) => (params.approvedOnly ? rows.approved : rows.latest))
    mocks.getLatestSpecAttempt.mockImplementation(async () => rows.latest)
  }
  const arrange = (unreadable = false) => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce({ profile: mocks.mockProfile, unreadable })
  }
  const call = () => GET(new Request('http://localhost/api/screening'), makeParams())

  const NOT_EVALUATED = [
    { name: 'solo hay un borrador', reason: 'spec_pending_approval', unreadable: false, rows: { approved: null, latest: draft(2) } },
    { name: 'no hay ningún protocolo extraído', reason: 'no_spec', unreadable: false, rows: { approved: null, latest: null } },
    { name: 'el protocolo aprobado no valida', reason: 'invalid_spec', unreadable: false, rows: { approved: approved(1, { nada: true }), latest: approved(1, { nada: true }) } },
    { name: 'el perfil no se pudo leer', reason: 'profile_unreadable', unreadable: true, rows: { approved: approved(1), latest: approved(1) } },
  ] as const

  it.each(NOT_EVALUATED)('$name: no evalúa y deja un registro, uno solo, con el motivo «$reason»', async ({ reason, unreadable, rows }) => {
    arrange(unreadable)
    store(rows)

    const res = await call()

    expect(res.status).toBe(200)
    expect(((await res.json()) as { profile: unknown }).profile).toBeDefined()
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toEqual({
      action: 'screening.view',
      orgId: mocks.ORG_ID,
      studyId: mocks.STUDY_ID,
      userId: mocks.USER_ID,
      resourceType: 'subject',
      resourceId: mocks.SUBJECT_ID,
      metadata: { evaluated: false, reason },
    })
  })

  it.each(NOT_EVALUATED)('$name: el registro no lleva ningún dato del sujeto', async ({ unreadable, rows }) => {
    arrange(unreadable)
    store(rows)

    await call()

    const written = JSON.stringify(mocks.writeAuditLog.mock.calls)
    expect(written).not.toContain('HbA1c')
    expect(written).not.toContain('MOCK-001')
  })

  it.each(NOT_EVALUATED)('$name: si el registro no se puede escribir, el perfil no se entrega', async ({ unreadable, rows }) => {
    arrange(unreadable)
    store(rows)
    mocks.writeAuditLog.mockRejectedValueOnce(new Error('sin base'))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('HbA1c')
  })

  it('con evaluación, el registro lo escribe el servicio y la ruta no suma otro', async () => {
    arrange()
    store({ approved: approved(1), latest: approved(1) })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    const res = await call()

    expect(res.status).toBe(200)
    expect(mocks.evaluateAndPersistScreening).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'sin sesión', status: 401 as const },
    { name: 'sin acceso al sujeto', status: 404 as const },
  ])('$name: no se entrega nada y no se registra una lectura que no ocurrió', async ({ status }) => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('x', status))

    const res = await call()

    expect(res.status).toBe(status)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
    expect(mocks.evaluateAndPersistScreening).not.toHaveBeenCalled()
  })

  it('guardián: cada respuesta que lleva el perfil y no pasó por la evaluación escribe antes su registro', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('../route.ts', import.meta.url)), 'utf8')
    const responsesWithProfile = source.split('profile: profileForResponse(profile)').length - 1
    const recordedWithoutEvaluation = source.split('await recordReadWithoutEvaluation(').length - 1
    const evaluated = source.split('await evaluateAndPersistScreening(').length - 1

    expect(evaluated).toBe(1)
    expect(responsesWithProfile).toBeGreaterThan(1)
    // Una rama nueva que entregue el perfil sin evaluar y sin registro rompe esta cuenta.
    expect(recordedWithoutEvaluation + evaluated).toBe(responsesWithProfile)
  })
})
