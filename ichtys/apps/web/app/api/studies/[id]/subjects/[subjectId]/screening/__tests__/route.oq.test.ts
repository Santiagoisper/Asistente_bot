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
}))

vi.mock('../../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../../../lib/subjects/patient-profile-service', () => ({
  loadPatientProfile: mocks.loadPatientProfile,
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
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)
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
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)
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
  it('metadata solo pass/fail/unknown/snapshotId', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)
    mocks.getLatestStudySpec.mockResolvedValueOnce({
      version: 1,
      status: 'approved',
      documentVersionId: 'doc-v1',
      spec: VALID_SPEC,
    })
    mocks.evaluateAndPersistScreening.mockResolvedValueOnce(mocks.mockEvaluation)

    await GET(new Request('http://localhost/api/screening'), makeParams())

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'screening.view',
        metadata: {
          pass: 1,
          fail: 0,
          unknown: 0,
          snapshotId: mocks.SNAPSHOT_ID,
        },
      }),
    )
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
    const metadataJson = JSON.stringify(auditCall.metadata)
    expect(metadataJson).not.toContain('HbA1c')
    expect(metadataJson).not.toContain('criterionText')
  })
})

describe('OQ-SCR06 — screening determinista (no LLM)', () => {
  it('usa evaluateAndPersistScreening (rule engine), no generación LLM', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)
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
