/**
 * OQ — profile GET (CSV Etapa 2).
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

  const mockProfile = {
    version: 1 as const,
    labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
    medications: [{ name: 'Metformina', dose: '850 mg' }],
    conditions: [] as string[],
  }

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    mockProfile,
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
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('../../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../../../lib/subjects/patient-profile-service', () => ({
  loadPatientProfile: mocks.loadPatientProfile,
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
      subjectCode: 'GZBO-001',
      studyId: mocks.STUDY_ID,
      organizationId: mocks.ORG_ID,
    },
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('OQ-P01 — profile sin autenticación', () => {
  it('GET devuelve 401', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(new Request('http://localhost/api/profile'), makeParams())

    expect(res.status).toBe(401)
    expect(mocks.loadPatientProfile).not.toHaveBeenCalled()
  })
})

describe('OQ-P02 — profile cross-org', () => {
  it('GET devuelve 404', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await GET(new Request('http://localhost/api/profile'), makeParams())

    expect(res.status).toBe(404)
    expect(mocks.loadPatientProfile).not.toHaveBeenCalled()
  })
})

describe('OQ-P03 — profile happy path', () => {
  it('GET devuelve subjectCode y profile', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)

    const res = await GET(new Request('http://localhost/api/profile'), makeParams())
    const body = (await res.json()) as { subjectCode: string; profile: typeof mocks.mockProfile }

    expect(res.status).toBe(200)
    expect(body.subjectCode).toBe('GZBO-001')
    expect(body.profile.labs[0]?.value).toBe(8.2)
  })
})

describe('OQ-P04 — audit profile.view sin PHI en metadata', () => {
  it('writeAuditLog no incluye profile ni metadata clínica', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.loadPatientProfile.mockResolvedValueOnce(mocks.mockProfile)

    await GET(new Request('http://localhost/api/profile'), makeParams())

    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as {
      action: string
      metadata?: Record<string, unknown>
      resourceType: string
      resourceId: string
    }
    expect(auditCall.action).toBe('profile.view')
    expect(auditCall.resourceType).toBe('subject')
    expect(auditCall.resourceId).toBe(mocks.SUBJECT_ID)
    expect(auditCall.metadata).toBeUndefined()
    const payload = JSON.stringify(auditCall)
    expect(payload).not.toContain('HbA1c')
    expect(payload).not.toContain('Metformina')
  })
})
