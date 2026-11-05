/**
 * Límite de bytes del cuerpo + orden auth→body en labs
 * (vuelta 2 del delta zod: H7 del Reviewer + requisito del Sicario).
 *
 * Rojo-verde contra el HEAD anterior (c5a9cc4):
 *  - body de labs > 256 KiB → antes parseaba TODO y seguía al safeParse;
 *    ahora corta con 413 sin leer el resto.
 *  - JSON inválido + acceso denegado → antes 400 (parseaba primero);
 *    ahora 401 (el subjectId viene de params: el auth va primero).
 *  - 501 labs válidos → antes aceptaba (sin cota); ahora 400 por .max(500).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  const SUBJECT_ID = crypto.randomUUID()
  const STUDY_ID = crypto.randomUUID()

  return {
    AccessError: MockAccessError,
    SUBJECT_ID,
    STUDY_ID,
    validateSubjectAccess: vi.fn(),
    handleApiError: vi.fn((err: unknown) => {
      if (err instanceof MockAccessError) {
        return new Response('Unauthorized', { status: err.status })
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

import { POST as confirmPost } from '../confirm/route'
import { POST as extractPost } from '../extract/route'

function makeParams() {
  return { params: Promise.resolve({ id: mocks.STUDY_ID, subjectId: mocks.SUBJECT_ID }) }
}

function subjectContext() {
  return {
    orgId: crypto.randomUUID(),
    userId: 'user_body_limit',
    study: { id: mocks.STUDY_ID },
    subject: { id: mocks.SUBJECT_ID, subjectCode: 'GZBO-LAB' },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('labs confirm — tope de bytes antes de parsear (413)', () => {
  it('body de labs de ~1,7 MiB → 413 sin llegar al servicio', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())

    const giant = { labs: Array.from({ length: 60_000 }, (_, i) => ({ name: `lab-${i}`, value: 1 })) }
    const res = await confirmPost(
      new Request('http://localhost/api/labs/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(giant),
      }),
      makeParams(),
    )

    expect(res.status).toBe(413)
    expect(mocks.confirmLabOcrReview).not.toHaveBeenCalled()
  })
})

describe('labs — el auth va antes del cuerpo cuando el id viene de params', () => {
  it('JSON inválido + acceso denegado → 401 (no 400): se valida acceso sin leer el body', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await confirmPost(
      new Request('http://localhost/api/labs/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"json": "roto"',
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.confirmLabOcrReview).not.toHaveBeenCalled()
  })

  it('extract ídem: acceso denegado responde antes de parsear el body', async () => {
    mocks.validateSubjectAccess.mockRejectedValueOnce(new mocks.AccessError('Unauthorized', 401))

    const res = await extractPost(
      new Request('http://localhost/api/labs/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'esto no es json',
      }),
      makeParams(),
    )

    expect(res.status).toBe(401)
    expect(mocks.proposeLabOcrReview).not.toHaveBeenCalled()
  })
})

describe('labOcrConfirmSchema — cota .max en labs (H7)', () => {
  it('501 labs válidos y chicos → 400 por too_big (antes se aceptaban)', async () => {
    mocks.validateSubjectAccess.mockResolvedValue(subjectContext())

    const overLimit = {
      labs: Array.from({ length: 501 }, (_, i) => ({ name: `lab-${i}`, value: 1 })),
    }
    const res = await confirmPost(
      new Request('http://localhost/api/labs/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overLimit), // ~15 KiB: pasa el byte-limit, corta el .max
      }),
      makeParams(),
    )

    expect(res.status).toBe(400)
    expect(mocks.confirmLabOcrReview).not.toHaveBeenCalled()
  })
})
