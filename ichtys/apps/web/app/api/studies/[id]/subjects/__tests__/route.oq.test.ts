/**
 * OQ — subjects list/create (CSV Etapa 2).
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

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    validatePhiStudyAccess: vi.fn(),
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
    encryptProfileJson: vi.fn(() => 'enc-profile-empty'),
    dbInsertReturning: vi.fn(),
    dbFindMany: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validatePhiStudyAccess: mocks.validatePhiStudyAccess,
  handleApiError: mocks.handleApiError,
  AccessError: mocks.AccessError,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mocks.dbInsertReturning,
      })),
    })),
    query: {
      subjects: {
        findMany: mocks.dbFindMany,
      },
    },
  },
  subjects: {},
  patientProfiles: {},
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../lib/subjects/phi-fields', () => ({
  encryptProfileJson: mocks.encryptProfileJson,
  PhiConfigError: class PhiConfigError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PhiConfigError'
    }
  },
}))

import { GET, POST } from '../route'

function makeParams(studyId = mocks.STUDY_ID) {
  return { params: Promise.resolve({ id: studyId }) }
}

function studyContext() {
  return {
    orgId: mocks.ORG_ID,
    userId: mocks.USER_ID,
    study: { id: mocks.STUDY_ID },
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('OQ-S01/S02 — subjects sin autenticación', () => {
  it('GET devuelve 401 sin auth', async () => {
    mocks.validatePhiStudyAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(new Request('http://localhost/api/subjects'), makeParams())

    expect(res.status).toBe(401)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('POST devuelve 401 sin auth', async () => {
    mocks.validatePhiStudyAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await POST(
      new Request('http://localhost/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectCode: 'TEST-001' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })
})

describe('OQ-S03 — subjects cross-org / study ajeno', () => {
  it('GET devuelve 404 cuando validatePhiStudyAccess rechaza', async () => {
    mocks.validatePhiStudyAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await GET(new Request('http://localhost/api/subjects'), makeParams())

    expect(res.status).toBe(404)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
  })
})

describe('OQ-S04 — POST happy path', () => {
  it('201 y encryptProfileJson({}) al crear sujeto', async () => {
    mocks.validatePhiStudyAccess.mockResolvedValueOnce(studyContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.SUBJECT_ID,
        subjectCode: 'TEST-001',
        status: 'screening',
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await POST(
      new Request('http://localhost/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectCode: 'test-001' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(201)
    expect(mocks.encryptProfileJson).toHaveBeenCalledWith({})
    const body = (await res.json()) as { subjectCode: string }
    expect(body.subjectCode).toBe('TEST-001')
  })
})

describe('OQ-S05/S06 — audit sin PHI', () => {
  it('subject.create — metadata solo subjectCode', async () => {
    mocks.validatePhiStudyAccess.mockResolvedValueOnce(studyContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.SUBJECT_ID,
        subjectCode: 'GZBO-001',
        status: 'screening',
        createdAt: new Date(),
      },
    ])

    await POST(
      new Request('http://localhost/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectCode: 'GZBO-001' }),
      }),
      makeParams(),
    )

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subject.create',
        metadata: { subjectCode: 'GZBO-001' },
      }),
    )
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
    expect(auditCall.metadata).not.toHaveProperty('profileEncrypted')
  })

  it('subject.view — metadata solo count', async () => {
    mocks.validatePhiStudyAccess.mockResolvedValueOnce(studyContext())
    mocks.dbFindMany.mockResolvedValueOnce([
      {
        id: mocks.SUBJECT_ID,
        subjectCode: 'GZBO-001',
        status: 'screening',
        createdAt: new Date('2026-07-04T12:00:00Z'),
        updatedAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await GET(new Request('http://localhost/api/subjects'), makeParams())

    expect(res.status).toBe(200)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subject.view',
        metadata: { count: 1 },
      }),
    )
  })
})
