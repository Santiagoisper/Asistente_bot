/**
 * OQ — Operational Qualification tests (CSV Etapa 2).
 * OQ-001: evolución sin auth → 401
 * OQ-002: evolución cross-org → 404
 * OQ-007: audit log sin contenido PHI
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
  const EVOLUTION_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    EVOLUTION_ID,
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
    encryptClinicalContent: vi.fn((text: string) => `enc:${text}`),
    decryptClinicalContent: vi.fn((enc: string) => enc.replace(/^enc:/, '')),
    detectPossiblePii: vi.fn().mockReturnValue([]),
    refreshPatientProfileFromEvolution: vi.fn().mockResolvedValue(undefined),
    dbInsertReturning: vi.fn(),
    dbFindMany: vi.fn(),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateSubjectAccess: mocks.validateSubjectAccess,
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
      clinicalEvolutions: {
        findMany: mocks.dbFindMany,
      },
    },
  },
  clinicalEvolutions: {},
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('../../../../../../../../lib/chat/persistence', () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({
  encryptClinicalContent: mocks.encryptClinicalContent,
  decryptClinicalContent: mocks.decryptClinicalContent,
  detectPossiblePii: mocks.detectPossiblePii,
  PhiConfigError: class PhiConfigError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PhiConfigError'
    }
  },
}))

vi.mock('../../../../../../../../lib/subjects/patient-profile-service', () => ({
  refreshPatientProfileFromEvolution: mocks.refreshPatientProfileFromEvolution,
}))

import { GET, POST } from '../route'

const CLINICAL_TEXT = 'Metformina 850 mg. HbA1c 8.2%. Sin eventos adversos.'

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

describe('OQ-001 — evolución sin autenticación', () => {
  it('POST devuelve 401 cuando validateSubjectAccess falla por Unauthorized', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('GET devuelve 401 cuando validateSubjectAccess falla por Unauthorized', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(401)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
  })
})

describe('OQ-002 — evolución cross-org / sujeto ajeno', () => {
  it('GET devuelve 404 cuando el sujeto no pertenece a la org activa', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(404)
    expect(mocks.dbFindMany).not.toHaveBeenCalled()
  })

  it('POST devuelve 404 cuando el sujeto no pertenece a la org activa', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(404)
    expect(mocks.dbInsertReturning).not.toHaveBeenCalled()
  })
})

describe('OQ-007 — audit log sin contenido PHI', () => {
  it('POST registra evolution.create con metadata acotada (sin texto clínico)', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: 'V1',
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT, visitLabel: 'V1' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(201)
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)

    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as {
      action: string
      metadata?: Record<string, unknown>
    }
    expect(auditCall.action).toBe('evolution.create')
    expect(auditCall.metadata).toBeDefined()
    expect(auditCall.metadata).not.toHaveProperty('content')
    expect(auditCall.metadata).not.toHaveProperty('contentEncrypted')
    expect(auditCall.metadata?.contentLength).toBe(CLINICAL_TEXT.length)
    expect(auditCall.metadata?.subjectId).toBe(mocks.SUBJECT_ID)

    const metadataJson = JSON.stringify(auditCall.metadata)
    expect(metadataJson).not.toContain('Metformina')
    expect(metadataJson).not.toContain('HbA1c')
  })

  it('GET registra evolution.view con count, sin evoluciones en metadata', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbFindMany.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: 'V1',
        contentEncrypted: 'enc:secret',
        authorUserId: mocks.USER_ID,
        createdAt: new Date('2026-07-04T12:00:00Z'),
      },
    ])

    const res = await GET(new Request('http://localhost/api/evolutions'), makeParams())

    expect(res.status).toBe(200)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'evolution.view',
        metadata: { count: 1 },
      }),
    )
  })
})

describe('OQ-003 — cifrado at-rest en POST', () => {
  it('persiste contentEncrypted vía encryptClinicalContent', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.dbInsertReturning.mockResolvedValueOnce([
      {
        id: mocks.EVOLUTION_ID,
        visitLabel: null,
        createdAt: new Date(),
      },
    ])

    await POST(
      new Request('http://localhost/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: CLINICAL_TEXT }),
      }),
      makeParams(),
    )

    expect(mocks.encryptClinicalContent).toHaveBeenCalledWith(CLINICAL_TEXT)
  })
})
