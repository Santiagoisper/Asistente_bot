/**
 * OQ — labs OCR human review (URS-007).
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
  const USER_ID = 'user_oq_lab'

  const profileWithPending = {
    version: 1 as const,
    labs: [] as Array<{ name: string; value: number; unit?: string }>,
    medications: [],
    conditions: [],
    pendingLabReview: {
      requiresHumanReview: true as const,
      extractedAt: '2026-07-04T12:00:00Z',
      labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
    },
  }

  const profileConfirmed = {
    version: 1 as const,
    labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
    medications: [],
    conditions: [],
  }

  return {
    AccessError: MockAccessError,
    ORG_ID,
    STUDY_ID,
    SUBJECT_ID,
    USER_ID,
    profileWithPending,
    profileConfirmed,
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
    proposeLabOcrReview: vi.fn(),
    confirmLabOcrReview: vi.fn(),
    rejectLabOcrReview: vi.fn(),
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

vi.mock('../../../../../../../../lib/subjects/lab-review-service', () => ({
  proposeLabOcrReview: mocks.proposeLabOcrReview,
  confirmLabOcrReview: mocks.confirmLabOcrReview,
  rejectLabOcrReview: mocks.rejectLabOcrReview,
  LabReviewError: class LabReviewError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message)
      this.name = 'LabReviewError'
    }
  },
}))

vi.mock('../../../../../../../../lib/subjects/phi-fields', () => ({
  PhiConfigError: class PhiConfigError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PhiConfigError'
    }
  },
}))

import { POST as extractPost } from '../extract/route'
import { POST as confirmPost } from '../confirm/route'
import { POST as rejectPost } from '../reject/route'

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
      subjectCode: 'GZBO-LAB',
      studyId: mocks.STUDY_ID,
      organizationId: mocks.ORG_ID,
    },
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('OQ-L01/L02 — labs extract auth', () => {
  it('POST extract sin auth → 401', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await extractPost(
      new Request('http://localhost/api/labs/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'HbA1c 8.2%' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.proposeLabOcrReview).not.toHaveBeenCalled()
  })

  it('POST extract cross-org → 404', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Not Found', 404))

    const res = await extractPost(
      new Request('http://localhost/api/labs/extract', {
        method: 'POST',
        body: JSON.stringify({ text: 'HbA1c 8.2%' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(404)
  })
})

describe('OQ-L03 — extract no persiste en labs[]', () => {
  it('pendingLabReview con requiresHumanReview; labsInProfile vacío', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.proposeLabOcrReview.mockResolvedValueOnce({
      profile: mocks.profileWithPending,
      labCount: 1,
      piiRedactedCount: 2,
    })

    const res = await extractPost(
      new Request('http://localhost/api/labs/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Paciente: X\nHbA1c: 8.2%' }),
      }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      pendingLabReview: { requiresHumanReview: boolean }
      labsInProfile: unknown[]
    }
    expect(body.pendingLabReview.requiresHumanReview).toBe(true)
    expect(body.labsInProfile).toEqual([])
  })
})

describe('OQ-L04/L05 — audit sin PHI', () => {
  it('lab.extract — metadata sin texto OCR', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.proposeLabOcrReview.mockResolvedValueOnce({
      profile: mocks.profileWithPending,
      labCount: 1,
      piiRedactedCount: 1,
    })

    await extractPost(
      new Request('http://localhost/api/labs/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'HbA1c 8.2%' }),
      }),
      makeParams(),
    )

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lab.extract',
        metadata: expect.objectContaining({
          requiresHumanReview: true,
          labCount: 1,
        }),
      }),
    )
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
    expect(auditCall.metadata).not.toHaveProperty('text')
    expect(auditCall.metadata).not.toHaveProperty('criterionText')
  })

  it('lab.confirm — metadata solo labCount', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.confirmLabOcrReview.mockResolvedValueOnce(mocks.profileConfirmed)

    await confirmPost(new Request('http://localhost/api/labs/confirm', { method: 'POST' }), makeParams())

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lab.confirm',
        metadata: { labCount: 1 },
      }),
    )
  })

  it('lab.reject — sin metadata PHI', async () => {
    mocks.validateSubjectAccess.mockResolvedValueOnce(subjectContext())
    mocks.rejectLabOcrReview.mockResolvedValueOnce(mocks.profileConfirmed)

    await rejectPost(new Request('http://localhost/api/labs/reject', { method: 'POST' }), makeParams())

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lab.reject',
        resourceType: 'subject',
      }),
    )
    const auditCall = mocks.writeAuditLog.mock.calls[0]?.[0] as { metadata?: unknown }
    expect(auditCall.metadata).toBeUndefined()
  })
})
